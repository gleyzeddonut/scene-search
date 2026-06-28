from scenesearch.screenplay.gender import (
    gender_from_table,
    pairing_from_genders,
    role_gender,
    guess_gender,
    scene_pairing,
)

TABLE = {"john": "male", "mary": "female"}


def test_gender_from_table_known():
    assert gender_from_table("JOHN", TABLE) == "male"
    assert gender_from_table("Mary", TABLE) == "female"


def test_gender_from_table_uses_first_name_only():
    assert gender_from_table("JOHN SMITH", TABLE) == "male"


def test_gender_from_table_unknown():
    assert gender_from_table("ZXQW", TABLE) == "unknown"
    assert gender_from_table("", TABLE) == "unknown"


def test_pairing_from_genders():
    assert pairing_from_genders(["male", "female"]) == "MW"
    assert pairing_from_genders(["female", "male"]) == "MW"
    assert pairing_from_genders(["male", "male"]) == "MM"
    assert pairing_from_genders(["female", "female"]) == "WW"
    assert pairing_from_genders(["male", "unknown"]) == "has_unknown"
    assert pairing_from_genders(["male"]) is None
    assert pairing_from_genders(["male", "female", "male"]) is None


def test_bundled_table_classifies_common_names():
    assert guess_gender("John") == "male"
    assert guess_gender("Mary") == "female"
    assert guess_gender("Zxqwlmn") == "unknown"


def test_role_gender():
    assert role_gender("MAN") == "male"
    assert role_gender("WOMAN") == "female"
    assert role_gender("OLD WOMAN") == "female"
    assert role_gender("YOUNG MAN") == "male"
    assert role_gender("WAITRESS") == "female"
    assert role_gender("BARTENDER") == "unknown"  # not a gendered role


def test_guess_gender_falls_back_to_roles():
    assert guess_gender("MAN") == "male"
    assert guess_gender("OLD WOMAN") == "female"
    assert guess_gender("BARTENDER") == "unknown"


def test_scene_pairing_uses_bundled_table():
    assert scene_pairing(["JOHN", "MARY"]) == "MW"
    assert scene_pairing(["JOHN", "JOHN"]) == "MM"
    assert scene_pairing(["JOHN"]) is None


def test_scene_pairing_with_role_names():
    assert scene_pairing(["MAN", "WOMAN"]) == "MW"
    assert scene_pairing(["WOMAN", "WAITRESS"]) == "WW"
