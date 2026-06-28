from scenesearch.theme import TOKENS, LIGHT, DARK, palette_for, build_qss


def test_palettes_define_all_tokens():
    for palette in (LIGHT, DARK):
        for token in TOKENS:
            assert token in palette, token
            assert palette[token].startswith("#")


def test_palette_for():
    assert palette_for("dark") is DARK
    assert palette_for("light") is LIGHT
    assert palette_for("nonsense") is LIGHT  # safe default


def test_build_qss_includes_colors():
    qss = build_qss(LIGHT)
    assert isinstance(qss, str) and len(qss) > 200
    assert LIGHT["window"] in qss
    assert LIGHT["accent"] in qss
