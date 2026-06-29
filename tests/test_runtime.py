from scenesearch.screenplay.runtime import estimate_seconds, scene_word_count


def test_word_count():
    assert scene_word_count([("A", "one two three"), ("B", "four five")]) == 5


def test_estimate_seconds():
    assert estimate_seconds(130) == 60  # 130 wpm
    assert estimate_seconds(0) == 0
