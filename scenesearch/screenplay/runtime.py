from __future__ import annotations

WPM = 130


def scene_word_count(lines) -> int:
    return sum(len(text.split()) for _who, text in lines)


def estimate_seconds(words: int) -> int:
    return round(words / WPM * 60)
