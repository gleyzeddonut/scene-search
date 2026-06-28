from scenesearch.screenplay.parser import parse_scenes

SCRIPT = """\
INT. DINER - DAY

NEIL sits down at the counter.

NEIL
Coffee, black.

EADY
Coming right up.

EXT. STREET - NIGHT

A man walks alone.

VINCENT
Anybody there?
"""


def test_splits_on_scene_headings():
    scenes = parse_scenes(SCRIPT)
    assert [s.heading for s in scenes] == ["INT. DINER - DAY", "EXT. STREET - NIGHT"]
    assert [s.index for s in scenes] == [1, 2]


def test_distinct_speaking_characters_per_scene():
    scenes = parse_scenes(SCRIPT)
    assert scenes[0].characters == ["NEIL", "EADY"]
    assert scenes[1].characters == ["VINCENT"]


def test_action_line_in_caps_is_not_a_character():
    assert parse_scenes(SCRIPT)[0].characters == ["NEIL", "EADY"]


def test_parentheticals_collapse_to_one_character():
    text = "INT. ROOM - DAY\n\nJANE (V.O.)\nHello?\n\nJANE\nGoodbye.\n"
    assert parse_scenes(text)[0].characters == ["JANE"]


def test_pages_from_form_feeds():
    text = "INT. A - DAY\n\nBOB\nHi.\n\fINT. B - DAY\n\nSUE\nYo.\n"
    scenes = parse_scenes(text)
    assert scenes[0].page == 1
    assert scenes[1].page == 2


def test_no_form_feeds_means_page_zero():
    assert parse_scenes(SCRIPT)[0].page == 0


def test_empty_text():
    assert parse_scenes("") == []
