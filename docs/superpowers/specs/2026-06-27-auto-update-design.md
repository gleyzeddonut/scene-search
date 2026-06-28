# Scene Search — In-App Auto-Update

**Date:** 2026-06-27
**Status:** Approved design, pending implementation plan

## Purpose

Let Scene Search update itself. When a newer signed release is published, the
running app (on the user's machine) shows an "Update available" banner; one click
downloads and stages the matching notarized build, a second click swaps it in and
relaunches.

## Hosting & distribution

- A new **public** GitHub repo, **`gleyzeddonut/scene-search`**, holds the full
  project. The local repo gains it as the `origin` remote and is pushed.
- Releases use **GitHub Releases**. Each release is tagged `vX.Y.Z` and carries
  the two notarized zips as assets: `Scene-Search-macOS-arm64.zip` and
  `Scene-Search-macOS-x86_64.zip`.
- The app checks the unauthenticated **latest-release API**:
  `https://api.github.com/repos/gleyzeddonut/scene-search/releases/latest`.
  Public repo ⇒ anonymous reads and anonymous asset downloads (no token).

## Versioning (single source of truth)

- `scenesearch/version.py` defines `__version__` (e.g. `"1.4.0"`).
- `packaging/Scene Search.spec` imports `__version__` for
  `CFBundleShortVersionString` / `CFBundleVersion` (replacing the hardcoded
  strings), so the bundle version and the updater's comparison always agree.
- The updater compares `__version__` against the latest release tag (the leading
  `v` is stripped before comparison).

## User experience

1. **Launch check** — a background thread hits the latest-release API. Failure
   (offline, rate-limited, API error) is silent: no banner, no error dialog.
2. **Banner** — if the latest tag is newer, a thin banner appears at the top of
   the window: `Update available: v1.5.0   [Update]`. It does not block use.
3. **Update click** — downloads the asset matching the running architecture to a
   staging folder, shows progress, unzips, and verifies the signature. On
   success the banner becomes `Update downloaded   [Relaunch to finish]`. On
   failure it shows a short message and reverts to the Update button.
4. **Relaunch click** — launches a detached helper script, then quits the app.
   The helper waits for the app's PID to exit, replaces the old `.app` with the
   staged one, and reopens it.

## macOS specifics

- **Frozen-only.** The updater is active only inside the real `.app`
  (`getattr(sys, "frozen", False)`). Running from source, the check still works
  but the install/relaunch path is disabled (the banner explains it only updates
  the packaged app).
- **App location / translocation.** If the bundle path is under an
  `AppTranslocation` mount (app launched straight from Downloads), self-update is
  impossible. The banner then reads:
  *"Move Scene Search to your Applications folder to enable updates."* From a
  user-writable location (`~/Applications`) the swap needs no admin. If the app
  lives in `/Applications` and the swap hits a permission error, the helper
  re-runs the swap with admin rights via
  `osascript -e 'do shell script "…" with administrator privileges'`.
- **Download safety.** Before staging, the downloaded `.app` is validated with
  `codesign --verify --strict` and its authority is confirmed to contain
  `Developer ID Application: ... (K7VM2MP885)`. A download that fails either
  check is discarded and never installed. (It is also notarized+stapled, so
  Gatekeeper re-validates on relaunch.)

## Architecture

GUI-free core (unit-tested) + thin Qt UI, mirroring the rest of the app.

```
scenesearch/
  version.py            # __version__ — single source of truth
  updater.py            # pure + IO helpers (no Qt):
                        #   parse_release(json) -> (version, {arch: url})
                        #   is_newer(latest, current) -> bool       (semver)
                        #   current_arch() -> "arm64" | "x86_64"
                        #   running_app_bundle() -> Path | None     (frozen)
                        #   is_translocated(path) -> bool
                        #   check_for_update(opener=...) -> UpdateInfo | None
                        #   download(url, dest, progress=None)
                        #   verify_bundle(app_path, team_id) -> bool
                        #   write_swap_script(old_app, new_app) -> Path
  ui/
    update_worker.py    # QThread workers: CheckWorker, DownloadWorker
    update_banner.py    # the banner widget (label + action button)
    main_window.py      # owns the banner; starts the check; wires actions
packaging/
  Scene Search.spec     # reads scenesearch.version.__version__
  publish_release.sh    # gh release create vX.Y.Z + upload both zips
```

### `updater.py` interfaces
- `UpdateInfo` dataclass: `version: str`, `url: str` (asset for this arch),
  `notes: str` (release body, optional display).
- `parse_release(data: dict) -> tuple[str, dict[str, str]]` — returns
  (`tag` without leading `v`, `{ "arm64": url, "x86_64": url }`) from the API
  JSON's `tag_name` + `assets[].name/browser_download_url`.
- `is_newer(latest: str, current: str) -> bool` — numeric tuple compare of
  dotted versions; non-numeric/malformed → `False` (never nag wrongly).
- `current_arch() -> str` — `platform.machine()` normalized to
  `"arm64"`/`"x86_64"`.
- `check_for_update(opener=urllib.request.urlopen, arch=None, current=None)
  -> UpdateInfo | None` — fetches the API, returns info only if newer and an
  asset for this arch exists; any exception → `None`.
- `running_app_bundle() -> Path | None` — when frozen, the `.app` root derived
  from `sys.executable`; else `None`.
- `is_translocated(path) -> bool` — path contains `/AppTranslocation/`.
- `download(url, dest, progress=None)` / `verify_bundle(app_path, team_id)` /
  `write_swap_script(old_app, new_app)` — IO helpers used by the UI.

### UI
- `CheckWorker` emits `update_available(UpdateInfo)` or nothing.
- `DownloadWorker` emits `progress(int)`, `ready(staged_app_path)`, `failed(str)`.
- `UpdateBanner`: hidden by default; shows message + a single action button whose
  label/handler changes across states (Update → downloading → Relaunch).
- `MainWindow`: starts the check on launch; on `update_available`, shows the
  banner (or the translocation message); wires Update/Relaunch.

## Data flow

1. Launch → `CheckWorker` → `check_for_update` → newer? show banner.
2. Update → `DownloadWorker` → `download` to staging → unzip → `verify_bundle`.
   Pass ⇒ banner switches to Relaunch; fail ⇒ message + revert.
3. Relaunch → `write_swap_script` → launch detached → `QApplication.quit()`.
   Helper: wait for old PID exit → replace bundle (admin-elevate if needed) →
   `open` the app.

## Error handling

- All network/API failures during check are swallowed (no banner, no dialog).
- Download/unzip/verify failures show a brief banner message and let the user
  retry; nothing is swapped.
- If `running_app_bundle()` is `None` (dev) or translocated, the install path is
  disabled with an explanatory banner instead of a broken button.
- The swap helper is best-effort; if it cannot replace the bundle (e.g. admin
  declined), the app simply reopens the old version.

## Testing

Unit tests (pure, no network):
- `is_newer`: `1.5.0>1.4.0`, `1.4.1>1.4.0`, equal→False, older→False,
  malformed→False, differing lengths (`1.4>1.3.9`).
- `parse_release`: extracts tag (strips `v`) and maps both arch assets by name.
- `check_for_update` with a stub `opener` returning canned JSON: returns
  `UpdateInfo` when newer, `None` when same/older, `None` on opener error.
- `current_arch` normalization; `is_translocated` true/false paths.

The download → verify → swap → relaunch path is verified **manually end-to-end**:
publish a throwaway higher version and confirm a running build updates itself.

## Out of scope (YAGNI)

- Background/automatic silent updates (always user-initiated via the banner).
- Delta/partial updates (always the full zip).
- Rollback UI (Time Machine / re-download an older release covers it).
- Update channels (beta/stable) — one latest release only.
- Windows/Linux update paths (macOS only).
