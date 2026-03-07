import re
from collections import Counter
from pathlib import Path
from typing import Any, Literal

import frontmatter
import markdown2
from bs4 import BeautifulSoup
from langchain_text_splitters import MarkdownHeaderTextSplitter

Repo = Literal['pydantic-ai', 'logfire']
repos: tuple[Repo, ...] = 'pydantic-ai', 'logfire'


def get_docs_dir(repo: Repo) -> Path:
    result = Path(__file__).parent.parent.parent.parent / repo / 'docs'
    if not result.exists():
        raise ValueError(f'This repo should live next to the {repo} repo')
    return result


IGNORED_FILES = 'release-notes.md', 'help.md', '/api/', '/legal/'


def get_docs_files(repo: Repo) -> list[Path]:
    return [
        file
        for file in get_docs_dir(repo).rglob('*.md')
        if not any(ignored in str(file) for ignored in IGNORED_FILES)
    ]


def get_markdown(path: Path) -> str:
    markdown_string = path.read_text()
    markdown_string = frontmatter.loads(markdown_string).content
    return markdown_string


def get_table_of_contents(repo: Repo):
    """Get a list of all docs files and a preview of the sections within."""
    result = ''
    for file in get_docs_files(repo):
        markdown_string = get_markdown(file)
        markdown_string = re.sub(
            r'^```\w+ [^\n]+$', '```', markdown_string, flags=re.MULTILINE
        )
        html_output = markdown2.markdown(markdown_string, extras=['fenced-code-blocks'])  # type: ignore
        soup = BeautifulSoup(html_output, 'html.parser')
        headers = soup.find_all(['h1', 'h2', 'h3', 'h4'])
        result += f'{file.relative_to(get_docs_dir(repo))}\n'
        result += '\n'.join(
            '#' * int(header.name[1]) + ' ' + header.get_text()  # type: ignore
            for header in headers
        )
        result += '\n\n'
    return result


headers_to_split_on = [('#' * n, f'H{n}') for n in range(1, 7)]


def get_docs_rows(repo: Repo) -> list[dict[str, Any]]:
    data: list[dict[str, Any]] = []
    for file in get_docs_files(repo):
        markdown_document = get_markdown(file)
        rel_path = str(file.relative_to(get_docs_dir(repo)))

        unique: set[tuple[tuple[str, ...], str]] = set()
        for num_headers in range(len(headers_to_split_on)):
            splitter = MarkdownHeaderTextSplitter(headers_to_split_on[:num_headers])
            splits = splitter.split_text(markdown_document)
            for split in splits:
                metadata: dict[str, Any] = split.metadata  # type: ignore
                headers = [
                    f'{prefix} {metadata[header_type]}'
                    for prefix, header_type in headers_to_split_on
                    if header_type in metadata
                ]
                content = '\n\n'.join([rel_path, *headers, split.page_content])
                if len(content.encode()) > 16384:
                    continue
                unique.add((tuple(headers), content))

        counts = Counter[tuple[str, ...]]()
        for headers, content in sorted(unique):
            counts[headers] += 1
            count = str(counts[headers])
            data.append(
                dict(
                    path=rel_path,
                    headers=headers,
                    text=content,
                    count=count,
                )
            )

    return data


if __name__ == '__main__':
    print(get_table_of_contents('logfire'))
    rows = get_docs_rows('logfire')
    print(f'Generated {len(rows)} rows')
