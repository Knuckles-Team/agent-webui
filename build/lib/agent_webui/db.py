import lancedb
from lancedb.embeddings import get_registry
from lancedb.pydantic import LanceModel, Vector  # type: ignore

from chatbot.data import get_docs_rows, Repo

db = lancedb.connect('/tmp/lancedb-pydantic-ai-chat')


def create_table(repo: Repo):
    embeddings = get_registry().get('sentence-transformers').create()  # type: ignore

    class Documents(LanceModel):
        path: str
        headers: list[str]
        count: int
        text: str = embeddings.SourceField()  # type: ignore
        vector: Vector(embeddings.ndims()) = embeddings.VectorField()  # type: ignore

    table = db.create_table(repo, schema=Documents, mode='overwrite')  # type: ignore
    table.create_fts_index('text')
    return table


def open_table(repo: Repo):
    try:
        return db.open_table(repo)
    except ValueError:
        return create_table(repo)


def populate_table(repo: Repo):
    table = open_table(repo)
    rows = get_docs_rows(repo)
    table.add(data=rows)  # type: ignore


def open_populated_table(repo: Repo):
    table = open_table(repo)
    if table.count_rows() == 0:
        populate_table(repo)
    return table
