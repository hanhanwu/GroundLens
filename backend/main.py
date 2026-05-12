from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
KNOWLEDGE_BASE_DIR = Path(__file__).resolve().parent.parent / "knowledge_base"

# Allow requests from the Expo dev server (localhost on common ports)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "GroundLens backend is running!"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/documents")
def documents(topic: str = Query(default="", max_length=100)):
    normalized_topic = topic.strip().lower()
    items = []

    for path in sorted(KNOWLEDGE_BASE_DIR.glob("*.txt")):
        content = path.read_text(encoding="utf-8")
        if normalized_topic and normalized_topic not in content.lower():
            continue

        title = content.splitlines()[0].strip() if content.splitlines() else path.stem
        items.append(
            {
                "id": path.stem,
                "title": title,
                "content": content,
            }
        )

    return {"topic": topic, "documents": items}
