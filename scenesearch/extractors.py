from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path


class ExtractionError(Exception):
    def __init__(self, path, reason: str):
        super().__init__(f"{path}: {reason}")
        self.path = Path(path)
        self.reason = reason


_PLAINTEXT_SUFFIXES = {".txt", ".fountain"}


def extract_text(path, max_chars: int = 20000, pdf_max_pages: int = 8) -> str:
    p = Path(path)
    suffix = p.suffix.lower()
    try:
        if suffix == ".pdf":
            return _extract_pdf(p, pdf_max_pages, max_chars)
        if suffix == ".docx":
            return _extract_docx(p, max_chars)
        if suffix == ".fdx":
            return _extract_fdx(p, max_chars)
        if suffix in _PLAINTEXT_SUFFIXES:
            return _extract_plaintext(p, max_chars)
    except ExtractionError:
        raise
    except Exception as exc:
        raise ExtractionError(p, str(exc)) from exc
    raise ExtractionError(p, f"unsupported extension '{suffix}'")


def _extract_plaintext(p: Path, max_chars: int) -> str:
    return p.read_text(encoding="utf-8", errors="ignore")[:max_chars]


def _extract_pdf(p: Path, pdf_max_pages: int, max_chars: int) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(p))
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception as exc:
            raise ExtractionError(p, "encrypted PDF") from exc
    parts: list[str] = []
    for page in reader.pages[:pdf_max_pages]:
        parts.append(page.extract_text() or "")
        if sum(len(x) for x in parts) >= max_chars:
            break
    return "\n".join(parts)[:max_chars]


def _extract_docx(p: Path, max_chars: int) -> str:
    import docx

    doc = docx.Document(str(p))
    return "\n".join(par.text for par in doc.paragraphs)[:max_chars]


def _extract_fdx(p: Path, max_chars: int) -> str:
    tree = ET.parse(str(p))
    texts = [el.text for el in tree.iter("Text") if el.text]
    return "\n".join(texts)[:max_chars]
