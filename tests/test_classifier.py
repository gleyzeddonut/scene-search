from scenesearch.classifier import score, DEFAULT_THRESHOLD

SCRIPT = """\
INT. COFFEE SHOP - DAY

JOHN sits alone, staring at his cup.

JOHN
I can't believe it's over.

EXT. CITY STREET - NIGHT

She walks away.

FADE OUT.
"""

ARTICLE = """\
The quarterly earnings report showed a modest increase in revenue.
Analysts had expected stronger growth, but supply constraints weighed
on the consumer electronics segment throughout the period.
"""


def test_real_screenplay_scores_high():
    confidence, cues = score(SCRIPT)
    assert confidence >= 0.7
    assert confidence > DEFAULT_THRESHOLD
    assert any("scene heading" in c for c in cues)


def test_non_script_scores_below_threshold():
    confidence, cues = score(ARTICLE)
    assert confidence < DEFAULT_THRESHOLD


def test_empty_text_scores_zero():
    assert score("") == (0.0, [])
    assert score("   \n  ") == (0.0, [])
