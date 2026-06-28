import time

from fastapi.testclient import TestClient

from scenesearch.service import create_app

TOKEN = "secret"
SCRIPT = "INT. OFFICE - DAY\n\nMICHAEL\nSit.\n\nJENNIFER\nNo.\n"


def _client(tmp_path):
    app = create_app(TOKEN, settings_path=tmp_path / "s.json", index_path=tmp_path / "i.db")
    return TestClient(app)


def _auth():
    return {"X-Scripty-Token": TOKEN}


def test_health_requires_token(tmp_path):
    c = _client(tmp_path)
    assert c.get("/health").status_code == 401
    r = c.get("/health", headers=_auth())
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_folders_get_and_put(tmp_path):
    c = _client(tmp_path)
    c.put("/folders", headers=_auth(), json={"roots": ["/a/b"], "ignored": ["/c"]})
    r = c.get("/folders", headers=_auth()).json()
    assert r["roots"] == ["/a/b"]
    assert r["ignored"] == ["/c"]


def test_stats_and_scenes_empty(tmp_path):
    c = _client(tmp_path)
    assert c.get("/stats", headers=_auth()).json() == {"scripts": 0, "scenes": 0}
    assert c.get("/scenes", headers=_auth()).json() == {"scenes": []}


def test_reindex_then_scenes(tmp_path):
    lib_dir = tmp_path / "lib"
    lib_dir.mkdir()
    (lib_dir / "x.fountain").write_text(SCRIPT)
    c = _client(tmp_path)
    c.put("/folders", headers=_auth(), json={"roots": [str(lib_dir)], "ignored": []})

    assert c.post("/reindex", headers=_auth()).json()["started"] is True
    for _ in range(100):
        st = c.get("/reindex/status", headers=_auth()).json()
        if not st["running"] and st["scenes"] > 0:
            break
        time.sleep(0.05)
    assert c.get("/stats", headers=_auth()).json()["scenes"] == 1

    scenes = c.get("/scenes", headers=_auth(), params={"min_chars": 2, "max_chars": 2}).json()["scenes"]
    assert len(scenes) == 1
    assert scenes[0]["heading"] == "INT. OFFICE - DAY"
    assert {ch["name"] for ch in scenes[0]["characters"]} == {"MICHAEL", "JENNIFER"}


def test_open_and_reveal(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr("scenesearch.service.fileops.open_external", lambda p: calls.append(("open", p)))
    monkeypatch.setattr("scenesearch.service.fileops.reveal_in_finder", lambda p: calls.append(("reveal", p)))
    c = _client(tmp_path)
    c.post("/open", headers=_auth(), json={"path": "/x/y.pdf"})
    c.post("/reveal", headers=_auth(), json={"path": "/x/y.pdf"})
    assert calls == [("open", "/x/y.pdf"), ("reveal", "/x/y.pdf")]
