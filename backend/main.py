import json
import logging
import os
from pathlib import Path

import httpx
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.DEBUG, format="%(levelname)s %(message)s")
log = logging.getLogger("groundlens")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
KNOWLEDGE_BASE_DIR = Path(__file__).resolve().parent.parent / "knowledge_base"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory cache: (sorted_topics_tuple, doc_id) -> {topic: [spans]}
_spans_cache: dict[tuple, dict[str, list[str]]] = {}
_CACHE_MAX = 500


@app.get("/")
def root():
    return {"message": "GroundLens backend is running!"}


@app.get("/health")
def health():
    return {"status": "ok", "groq_key_set": bool(GROQ_API_KEY)}


def _find_verbatim(span: str, content: str) -> str | None:
    """Case-insensitive search; returns the original-cased text from the document."""
    idx = content.lower().find(span.lower())
    if idx == -1:
        return None
    return content[idx : idx + len(span)]


async def find_spans_for_topics(
    topics: list[str], content: str, doc_id: str
) -> dict[str, list[str]]:
    """One Groq call to find up to 3 verbatim spans per topic in content."""
    cache_key = (tuple(sorted(topics)), doc_id)
    if cache_key in _spans_cache:
        return _spans_cache[cache_key]

    empty: dict[str, list[str]] = {t: [] for t in topics}

    if not GROQ_API_KEY:
        return empty

    topics_json = json.dumps(topics)
    prompt = (
        "You are a precise text-analysis assistant.\n"
        "Given a list of topics and a document, find up to 3 short verbatim excerpts "
        "from the document that are most relevant to EACH topic.\n\n"
        "Rules:\n"
        "- Each excerpt must be copied VERBATIM from the document — no paraphrasing\n"
        "- Each excerpt should be a meaningful phrase, clause, or sentence (not a single word)\n"
        "- Return at most 3 excerpts per topic; return fewer if fewer are relevant\n"
        "- If nothing in the document is relevant to a topic, use an empty array for that topic\n"
        "- Reply with ONLY a valid JSON object mapping each topic to its array of excerpts\n"
        "- No explanation, no markdown fences\n\n"
        f"Topics: {topics_json}\n\n"
        f"Document:\n{content}\n\n"
        'Example reply: {"topic one": ["verbatim phrase"], "topic two": []}'
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
        log.debug("Groq raw response for doc=%s topics=%s:\n%s", doc_id, topics, raw)

        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            log.warning("Groq returned non-dict for doc=%s: %r", doc_id, parsed)
            return empty

        result: dict[str, list[str]] = {}
        for topic in topics:
            spans = parsed.get(topic, [])
            if not isinstance(spans, list):
                spans = []
            verified = []
            for s in spans:
                if not isinstance(s, str) or not s.strip():
                    continue
                found = _find_verbatim(s, content)
                if found:
                    verified.append(found)
                else:
                    log.debug("Span not found in doc=%s topic=%r span=%r", doc_id, topic, s)
            result[topic] = verified[:3]
            log.debug("doc=%s topic=%r => verified spans: %s", doc_id, topic, result[topic])

        # Evict oldest entries if cache is full
        if len(_spans_cache) >= _CACHE_MAX:
            oldest = next(iter(_spans_cache))
            del _spans_cache[oldest]

        # Only cache if at least one topic got spans — avoids persisting empty results
        # from truncated prompts or transient Groq errors
        if any(result.values()):
            _spans_cache[cache_key] = result
        return result

    except Exception as exc:
        log.exception("Groq call failed for doc=%s topics=%s: %s", doc_id, topics, exc)
        return empty


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

            topic_spans = await find_spans_for_topics(topics, content, path.stem)
            log.debug("Final topicSpans for doc=%s: %s", path.stem, topic_spans)

            # Only include document if Groq found at least one span for any topic
            if GROQ_API_KEY and not any(topic_spans.values()):
                log.debug("No spans found, excluding doc=%s", path.stem)
                continue
        else:
            topic_spans = {}

        title = content.splitlines()[0].strip() if content.splitlines() else path.stem
        items.append(
            {
                "id": path.stem,
                "title": title,
                "content": content,
                "topicSpans": topic_spans,
            }
        )

    return {"documents": items}
