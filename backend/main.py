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


def _get_doc_uuid(doc_id: str, content: str = "") -> str | None:
    """Return the Supabase UUID for a document, auto-registering it if not found.

    Lookup order:
      1. file_path match  (covers documents uploaded via /upload)
      2. title match      (covers re-uploaded or title-matched docs)
      3. auto-register    (covers files placed directly in knowledge_base/)
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return None
    try:
        # 1. Look up by file_path
        result = (
            supabase.table("documents")
            .select("id")
            .eq("file_path", f"{doc_id}.txt")
            .limit(1)
            .execute()
        )
        if result.data:
            return result.data[0]["id"]

        if not content:
            return None

        # 2. Fallback: look up by title (first non-empty line of content)
        title = next((l.strip() for l in content.splitlines() if l.strip()), doc_id)
        result = (
            supabase.table("documents")
            .select("id")
            .eq("title", title)
            .limit(1)
            .execute()
        )
        if result.data:
            return result.data[0]["id"]

        # 3. Auto-register the document so future calls can use the cache
        log.debug("Auto-registering doc=%s in Supabase", doc_id)
        supabase.table("documents").upsert(
            {"title": title, "content": content, "file_path": f"{doc_id}.txt"},
            on_conflict="title",
        ).execute()
        result = (
            supabase.table("documents")
            .select("id")
            .eq("title", title)
            .limit(1)
            .execute()
        )
        return result.data[0]["id"] if result.data else None
    except Exception as exc:
        log.debug("_get_doc_uuid failed for doc=%s: %s", doc_id, exc)
        return None


def _load_topic_cache(
    db_doc_id: str, topics: list[str]
) -> dict[str, dict | None]:
    """Load cached spans + Q&A from Supabase for each topic (matched case-insensitively).

    Returns a mapping of {topic_lower -> {"spans": [...], "qa": [...]}} for every
    topic that has a cached entry, and {topic_lower -> None} for uncached topics.
    Topics are stored lowercase in the highlights table.
    """
    normalized = [t.lower() for t in topics]
    result: dict[str, dict | None] = {t: None for t in normalized}
    try:
        h_rows = (
            supabase.table("highlights")
            .select("id,topic,span")
            .eq("document_id", db_doc_id)
            .in_("topic", normalized)
            .execute()
        )
        if not h_rows.data:
            return result

        # Group highlights by (lowercase) topic
        by_topic: dict[str, list[dict]] = {}
        highlight_ids: list[str] = []
        for row in h_rows.data:
            by_topic.setdefault(row["topic"], []).append(row)
            highlight_ids.append(row["id"])

        # Bulk-load all Q&A pairs for the found highlights
        qa_rows = (
            supabase.table("qa_pairs")
            .select("highlight_id,question,answer")
            .in_("highlight_id", highlight_ids)
            .execute()
        )
        qa_by_highlight: dict[str, list[dict]] = {}
        for row in qa_rows.data or []:
            qa_by_highlight.setdefault(row["highlight_id"], []).append(row)

        for topic_lower, highlights in by_topic.items():
            spans = [h["span"] for h in highlights]
            qa: list[dict] = []
            for h in highlights:
                for qa_row in qa_by_highlight.get(h["id"], []):
                    qa.append(
                        {
                            "span": h["span"],
                            "question": qa_row["question"],
                            "answer": qa_row["answer"],
                        }
                    )
            result[topic_lower] = {"spans": spans, "qa": qa}

        log.debug(
            "Supabase cache: doc=%s cached=%s uncached=%s",
            db_doc_id,
            [t for t, v in result.items() if v is not None],
            [t for t, v in result.items() if v is None],
        )
    except Exception as exc:
        log.warning("Supabase cache read failed for doc=%s: %s", db_doc_id, exc)
    return result


def _save_topic_cache(
    db_doc_id: str, spans: dict[str, list[str]], qa: list[dict]
) -> None:
    """Upsert newly generated spans and Q&A pairs into Supabase.

    Topics are stored lowercase so lookups are always case-insensitive.
    """
    try:
        for topic, span_list in spans.items():
            if not span_list:
                continue
            topic_lower = topic.lower()
            for span in span_list:
                # Upsert the highlight row
                supabase.table("highlights").upsert(
                    {"document_id": db_doc_id, "topic": topic_lower, "span": span},
                    on_conflict="document_id,topic,span",
                ).execute()

                # Fetch its id (upsert doesn't reliably return it across all versions)
                h_row = (
                    supabase.table("highlights")
                    .select("id")
                    .eq("document_id", db_doc_id)
                    .eq("topic", topic_lower)
                    .eq("span", span)
                    .limit(1)
                    .execute()
                )
                if not h_row.data:
                    log.warning("Could not find highlight after upsert: doc=%s topic=%s", db_doc_id, topic_lower)
                    continue
                highlight_id = h_row.data[0]["id"]

                # Upsert each Q&A pair that belongs to this span
                for qa_item in qa:
                    if qa_item["span"] != span:
                        continue
                    supabase.table("qa_pairs").upsert(
                        {
                            "document_id": db_doc_id,
                            "highlight_id": highlight_id,
                            "question": qa_item["question"],
                            "answer": qa_item["answer"],
                        },
                        on_conflict="highlight_id,question",
                    ).execute()

        log.debug("Saved to Supabase cache: doc=%s topics=%s", db_doc_id, list(spans.keys()))
    except Exception as exc:
        log.warning("Supabase cache save failed for doc=%s: %s", db_doc_id, exc)


async def find_spans_and_qa(
    topics: list[str], content: str, doc_id: str
) -> tuple[dict[str, list[str]], list[dict]]:
    """Find verbatim spans per topic and generate one Q&A pair per span.

    Cache hierarchy:
      1. In-memory (_combined_cache) — fastest, per process lifetime
      2. Supabase highlights/qa_pairs — persists across restarts, keyed by
         (document_id, topic_lower).  Only uncached topics are sent to Groq.
    """
    cache_key = (tuple(sorted(topics)), doc_id)
    if cache_key in _combined_cache:
        cached = _combined_cache[cache_key]
        return cached["spans"], cached["qa"]

    empty_spans: dict[str, list[str]] = {t: [] for t in topics}

    # ------------------------------------------------------------------ #
    # Supabase cache — resolve per-topic, allow partial hits              #
    # ------------------------------------------------------------------ #
    db_doc_id: str | None = None
    cached_spans: dict[str, list[str]] = {}
    cached_qa: list[dict] = []
    topics_for_groq = list(topics)       # will shrink as cache hits are found

    if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
        db_doc_id = _get_doc_uuid(doc_id, content)
        if db_doc_id:
            cache_data = _load_topic_cache(db_doc_id, topics)
            topics_for_groq = []
            for topic in topics:
                hit = cache_data.get(topic.lower())
                if hit is not None:
                    cached_spans[topic] = hit["spans"]
                    cached_qa.extend(hit["qa"])
                else:
                    topics_for_groq.append(topic)

            if not topics_for_groq:
                # Full Supabase cache hit — skip Groq entirely
                _combined_cache[cache_key] = {"spans": cached_spans, "qa": cached_qa}
                return cached_spans, cached_qa

    if not GROQ_API_KEY:
        return {**empty_spans, **cached_spans}, cached_qa

    # ------------------------------------------------------------------ #
    # Groq call — only for topics not yet cached                          #
    # ------------------------------------------------------------------ #
    topics_json = json.dumps(topics_for_groq)
    prompt = (
        "You are a precise text-analysis assistant.\n"
        "Given a list of topics and a document, do the following:\n"
        "1. For each topic, find 1 short verbatim excerpt from the document.\n"
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
        log.debug("Groq combined response for doc=%s topics=%s:\n%s", doc_id, topics_for_groq, raw)

        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            log.warning("Groq returned non-dict for doc=%s: %r", doc_id, parsed)
            return {**empty_spans, **cached_spans}, cached_qa

        # --- Parse spans (only for topics sent to Groq) ---
        result_spans: dict[str, list[str]] = {}
        for topic in topics_for_groq:
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

        # --- Parse Q&A (_qa key) ---
        verified_span_set = {s for spans in result_spans.values() for s in spans}
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
                    verified_span = _find_verbatim(item["span"], content)
                    if not verified_span:
                        log.debug("QA span not found in doc=%s span=%r", doc_id, item["span"])
                        continue
                    if verified_span not in verified_span_set:
                        log.debug("QA span not in topic spans, skipping doc=%s span=%r", doc_id, verified_span)
                        continue
                    result_qa.append({
                        "span": verified_span,
                        "question": item["question"],
                        "answer": item["answer"],
                    })

        # ------------------------------------------------------------------ #
        # Persist new Groq results to Supabase                               #
        # ------------------------------------------------------------------ #
        if any(result_spans.values()) and SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
            if db_doc_id is None:
                db_doc_id = _get_doc_uuid(doc_id, content)
            if db_doc_id:
                _save_topic_cache(db_doc_id, result_spans, result_qa)

        # Merge cached + new results then populate in-memory cache
        final_spans = {**empty_spans, **cached_spans, **result_spans}
        final_qa = cached_qa + result_qa

        if any(final_spans.values()):
            if len(_combined_cache) >= _CACHE_MAX:
                oldest = next(iter(_combined_cache))
                del _combined_cache[oldest]
            _combined_cache[cache_key] = {"spans": final_spans, "qa": final_qa}

        return final_spans, final_qa

    except Exception as exc:
        log.exception("Groq call failed for doc=%s topics=%s: %s", doc_id, topics_for_groq, exc)
        return {**empty_spans, **cached_spans}, cached_qa


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
