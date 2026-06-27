import pytest

from scenesearch.extractors import extract_text, ExtractionError


def test_plaintext_fountain(tmp_path):
    f = tmp_path / "script.fountain"
    f.write_text("INT. ROOM - DAY\n\nHello.\n")
    assert "INT. ROOM" in extract_text(f)


def test_txt(tmp_path):
    f = tmp_path / "notes.txt"
    f.write_text("some plain text")
    assert extract_text(f) == "some plain text"


def test_fdx_xml(tmp_path):
    f = tmp_path / "movie.fdx"
    f.write_text(
        '<?xml version="1.0"?>'
        "<FinalDraft><Content>"
        '<Paragraph Type="Scene Heading"><Text>INT. HOUSE - DAY</Text></Paragraph>'
        '<Paragraph Type="Action"><Text>A man enters.</Text></Paragraph>'
        "</Content></FinalDraft>"
    )
    out = extract_text(f)
    assert "INT. HOUSE - DAY" in out
    assert "A man enters." in out


def test_unsupported_extension_raises(tmp_path):
    f = tmp_path / "image.jpg"
    f.write_bytes(b"\xff\xd8\xff")
    with pytest.raises(ExtractionError) as exc:
        extract_text(f)
    assert "unsupported" in exc.value.reason


def test_corrupt_pdf_raises(tmp_path):
    f = tmp_path / "broken.pdf"
    f.write_bytes(b"not a real pdf")
    with pytest.raises(ExtractionError):
        extract_text(f)


def test_max_chars_truncates(tmp_path):
    f = tmp_path / "big.txt"
    f.write_text("x" * 5000)
    assert len(extract_text(f, max_chars=100)) == 100
