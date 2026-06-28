from __future__ import annotations

import threading
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from . import fileops
from .finder import FilterSpec, scene_rows
from .library import Library
from .scanner import default_roots
from .screenplay.gender import guess_gender
from .settings import Settings
from .version import __version__


class Folders(BaseModel):
    roots: list[str]
    ignored: list[str] = []


class PathBody(BaseModel):
    path: str


def create_app(token: str, settings_path=None, index_path=None) -> FastAPI:
    app = FastAPI()
    settings = Settings(settings_path or Path.home() / ".scripty_settings.json")
    index_path = Path(index_path or Path.home() / ".scripty_index.db")
    state = {"running": False, "scanned": 0, "scripts": 0, "scenes": 0}

    def auth(x_scripty_token: str = Header(default="")):
        if x_scripty_token != token:
            raise HTTPException(status_code=401, detail="bad token")

    def lib() -> Library:
        return Library(index_path)

    @app.get("/health")
    def health(_=Depends(auth)):
        return {"status": "ok", "version": __version__}

    @app.get("/folders")
    def get_folders(_=Depends(auth)):
        roots = settings.get_roots()
        roots = roots if roots is not None else [str(r) for r in default_roots()]
        return {"roots": roots, "ignored": settings.get_ignored() or []}

    @app.put("/folders")
    def put_folders(body: Folders, _=Depends(auth)):
        settings.set_roots(body.roots)
        settings.set_ignored(body.ignored)
        return {"roots": body.roots, "ignored": body.ignored}

    @app.get("/stats")
    def stats(_=Depends(auth)):
        library = lib()
        try:
            return {"scripts": library.script_count(), "scenes": library.scene_count()}
        finally:
            library.close()

    @app.get("/scenes")
    def scenes(min_chars: int | None = None, max_chars: int | None = None,
               pairing: str | None = None, search: str = "", _=Depends(auth)):
        spec = FilterSpec(min_chars=min_chars, max_chars=max_chars, pairing=pairing or None)
        s = search.lower()
        library = lib()
        try:
            out = []
            for m in scene_rows(library, spec):
                if s and s not in m.script_name.lower() and s not in m.heading.lower():
                    continue
                out.append({
                    "script_path": m.script_path, "script_name": m.script_name,
                    "heading": m.heading, "page": m.page, "char_count": m.char_count,
                    "characters": [{"name": n, "gender": guess_gender(n)} for n in m.characters],
                    "pairing": m.pairing,
                })
            return {"scenes": out}
        finally:
            library.close()

    def _do_reindex(roots):
        state.update(running=True, scanned=0)
        try:
            if roots:
                worker = lib()
                try:
                    worker.reindex(roots[0])
                    state["scripts"] = worker.script_count()
                    state["scenes"] = worker.scene_count()
                finally:
                    worker.close()
        finally:
            state["running"] = False

    @app.post("/reindex")
    def reindex(_=Depends(auth)):
        roots = settings.get_roots() or [str(r) for r in default_roots()]
        if not state["running"]:
            threading.Thread(target=_do_reindex, args=(roots,), daemon=True).start()
        return {"started": True}

    @app.get("/reindex/status")
    def reindex_status(_=Depends(auth)):
        return {"running": state["running"], "scanned": state["scanned"],
                "scripts": state["scripts"], "scenes": state["scenes"]}

    @app.post("/open")
    def open_file(body: PathBody, _=Depends(auth)):
        fileops.open_external(body.path)
        return {"ok": True}

    @app.post("/reveal")
    def reveal(body: PathBody, _=Depends(auth)):
        fileops.reveal_in_finder(body.path)
        return {"ok": True}

    return app


def main() -> None:
    import argparse

    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--token", required=True)
    args = parser.parse_args()
    app = create_app(args.token)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
