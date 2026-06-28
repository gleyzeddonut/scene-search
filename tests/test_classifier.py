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


def test_numbered_shooting_script_is_detected():
    text = (
        "1   INT. WAREHOUSE - NIGHT      1\n\nJACK\nHello.\n\n"
        "2   EXT. ALLEY - DAY            2\n\nMARIA\nHi.\n\n"
        "3   INT. CAR - NIGHT            3\n\nJACK\nGo.\n"
    )
    confidence, cues = score(text)
    assert confidence > DEFAULT_THRESHOLD
    assert any("scene heading" in c for c in cues)


def test_caps_action_lines_do_not_count_as_character_cues():
    # All-caps sentences ending in punctuation are action, not character cues.
    text = "THE PHONE RINGS.\nSUDDENLY IT STOPS.\nA LOUD CRASH!\n"
    confidence, cues = score(text)
    assert confidence < DEFAULT_THRESHOLD
    assert not any("character cue" in c for c in cues)
