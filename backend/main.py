import json
import logging
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

logging.basicConfig(level=logging.DEBUG, format="%(levelname)s %(message)s")
log = logging.getLogger("groundlens")


SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
KNOWLEDGE_BASE_DIR = Path(__file__).resolve().parent.parent / "knowledge_base"

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory cache: (sorted_topics_tuple, doc_id) -> {"spans": {topic: [spans]}, "qa": [...]}
_combined_cache: dict[tuple, dict] = {}
_CACHE_MAX = 500


@app.get("/")
def root():
    return {"message": "GroundLens backend is running!"}


@app.get("/health")
def health():
    return {"status": "ok", "groq_key_set": bool(GROQ_API_KEY)}


@app.post("/upload")
async def upload_document(file: UploadFile):
    """Save an uploaded file to knowledge_base/ and upsert it into Supabase."""
    KNOWLEDGE_BASE_DIR.mkdir(parents=True, exist_ok=True)

    content_bytes = await file.read()
    try:
        text = content_bytes.decode('utf-8')
    except UnicodeDecodeError:
        text = content_bytes.decode('latin-1', errors='replace')

    # Sanitise filename and always persist as .txt so the /documents endpoint picks it up
    raw_name = (file.filename or 'document').strip()
    base = raw_name.rsplit('.', 1)[0] if '.' in raw_name else raw_name
    safe_base = ''.join(c if c.isalnum() or c in '-_ ' else '_' for c in base).strip('_') or 'document'
    safe_name = safe_base + '.txt'
    dest = KNOWLEDGE_BASE_DIR / safe_name
    dest.write_text(text, encoding='utf-8')
    log.info("Saved upload to %s (%d bytes)", dest, len(content_bytes))

    # Upsert into Supabase documents table (title must be unique per schema)
    title = next((line.strip() for line in text.splitlines() if line.strip()), safe_name)
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        log.warning("Supabase credentials not configured — skipping DB upsert")
        return {'filename': safe_name, 'status': 'saved', 'db': 'skipped (no credentials)'}

    try:
        response = supabase.table('documents').upsert(
            {'title': title, 'content': text, 'file_path': safe_name},
            on_conflict='title',
        ).execute()
        log.info("Upserted '%s' into Supabase: %s", title, response)
    except Exception as exc:
        log.error("Supabase upsert failed for %s: %s", safe_name, exc)
        raise HTTPException(status_code=500, detail=f"File saved locally but database upsert failed: {exc}")

    return {'filename': safe_name, 'status': 'saved', 'db': 'upserted'}


def _find_verbatim(span: str, content: str) -> str | None:
    """Case-insensitive search; returns the original-cased text from the document."""
    idx = content.lower().find(span.lower())
    if idx == -1:
        return None
    return content[idx : idx + len(span)]


async def find_spans_and_qa(
    topics: list[str], content: str, doc_id: str
) -> tuple[dict[str, list[str]], list[dict]]:
    """Single Groq call: find verbatim spans per topic AND generate one Q&A pair per span."""
    cache_key = (tuple(sorted(topics)), doc_id)
    if cache_key in _combined_cache:
        cached = _combined_cache[cache_key]
        return cached["spans"], cached["qa"]

    empty_spans: dict[str, list[str]] = {t: [] for t in topics}

    if not GROQ_API_KEY:
        return empty_spans, []

    topics_json = json.dumps(topics)
    prompt = (
        "You are a precise text-analysis assistant.\n"
        "Given a list of topics and a document, do the following:\n"
        "1. For each topic, find up to 3 short verbatim excerpts from the document.\n"
        "2. For every excerpt you found, add one entry to a special \"_qa\" key: "
        "a question the excerpt answers plus a concise 1-2 sentence answer.\n\n"
        "Rules:\n"
        "- Excerpts must be copied VERBATIM from the document — no paraphrasing\n"
        "- Each excerpt is a meaningful phrase, clause, or sentence (not a single word)\n"
        "- If a topic has no relevant excerpt use an empty array\n"
        "- Reply ONLY with valid JSON, no markdown fences, no extra text\n"
        "- The JSON object has one key per topic (array of excerpts) "
        "plus a \"_qa\" key (array of Q&A objects)\n\n"
        f"Topics: {topics_json}\n\n"
        f"Document:\n{content}\n\n"
        "Example reply for topics [\"foo\", \"bar\"]:\n"
        '{"foo": ["verbatim phrase one"], "bar": [], '
        '"_qa": [{"span": "verbatim phrase one", "question": "What is...?", "answer": "It is..."}]}'
    )

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                GROQ_API_URL,
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "llama-3.1-8b-instant",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                },
            )
            response.raise_for_status()

        raw = response.json()["choices"][0]["message"]["content"].strip()
        log.debug("Groq combined response for doc=%s topics=%s:\n%s", doc_id, topics, raw)

        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            log.warning("Groq returned non-dict for doc=%s: %r", doc_id, parsed)
            return empty_spans, []

        # --- Parse spans (flat: topic -> [excerpts]) ---
        result_spans: dict[str, list[str]] = {}
        for topic in topics:
            raw_list = parsed.get(topic, [])
            if not isinstance(raw_list, list):
                raw_list = []
            verified: list[str] = []
            for s in raw_list:
                if not isinstance(s, str) or not s.strip():
                    continue
                found = _find_verbatim(s, content)
                if found:
                    verified.append(found)
                else:
                    log.debug("Span not found doc=%s topic=%r span=%r", doc_id, topic, s)
            result_spans[topic] = verified[:1]
            log.debug("doc=%s topic=%r => spans: %s", doc_id, topic, result_spans[topic])

        # --- Parse Q&A (_qa key in same flat object) ---
        qa_raw = parsed.get("_qa", [])
        result_qa: list[dict] = []
        if isinstance(qa_raw, list):
            for item in qa_raw:
                if (
                    isinstance(item, dict)
                    and isinstance(item.get("span"), str)
                    and isinstance(item.get("question"), str)
                    and isinstance(item.get("answer"), str)
                ):
                    result_qa.append({
                        "span": item["span"],
                        "question": item["question"],
                        "answer": item["answer"],
                    })

        # Cache only when spans were found (avoids persisting empty transient failures)
        if any(result_spans.values()):
            if len(_combined_cache) >= _CACHE_MAX:
                oldest = next(iter(_combined_cache))
                del _combined_cache[oldest]
            _combined_cache[cache_key] = {"spans": result_spans, "qa": result_qa}

        return result_spans, result_qa

    except Exception as exc:
        log.exception("Groq call failed for doc=%s topics=%s: %s", doc_id, topics, exc)
        return empty_spans, []


def _word_pre_filter(topics: list[str], content: str) -> bool:
    """Return True if any word from any topic appears in the document (case-insensitive).
    Cheap guard to avoid wasting Groq tokens on clearly irrelevant documents."""
    lower = content.lower()
    return any(
        word in lower
        for topic in topics
        for word in topic.lower().split()
        if len(word) > 2  # skip very short stop words
    )


@app.get("/documents")
async def documents(topic: list[str] = Query(default=[])):
    topics = [t.strip() for t in topic if t.strip()]
    items = []

    for path in sorted(KNOWLEDGE_BASE_DIR.glob("*.txt")):
        content = path.read_text(encoding="utf-8")

        if topics:
            # Cheap pre-filter: skip docs with zero lexical overlap
            if not _word_pre_filter(topics, content):
                log.debug("Pre-filter skipped doc=%s for topics=%s", path.stem, topics)
                continue

            topic_spans, qa_pairs = await find_spans_and_qa(topics, content, path.stem)
            log.debug("Final topicSpans for doc=%s: %s", path.stem, topic_spans)

            # Only include document if Groq found at least one span for any topic
            if GROQ_API_KEY and not any(topic_spans.values()):
                log.debug("No spans found, excluding doc=%s", path.stem)
                continue
        else:
            topic_spans = {}
            qa_pairs = []

        title = content.splitlines()[0].strip() if content.splitlines() else path.stem
        items.append(
            {
                "id": path.stem,
                "title": title,
                "content": content,
                "topicSpans": topic_spans,
                "qaPairs": qa_pairs,
            }
        )

    return {"documents": items}
