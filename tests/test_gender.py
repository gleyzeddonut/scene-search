from scenesearch.screenplay.gender import (
    gender_from_table,
    pairing_from_genders,
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


def test_scene_pairing_uses_bundled_table():
    assert scene_pairing(["JOHN", "MARY"]) == "MW"
    assert scene_pairing(["JOHN", "JOHN"]) == "MM"
    assert scene_pairing(["JOHN"]) is None
