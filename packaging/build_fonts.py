"""Download the OFL-licensed UI fonts into scenesearch/fonts/.
Run once: .venv/bin/python packaging/build_fonts.py"""
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "scenesearch" / "fonts"
FONTS = {
    "SpaceGrotesk.ttf": "https://github.com/google/fonts/raw/main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf",
    "CourierPrime.ttf": "https://github.com/google/fonts/raw/main/ofl/courierprime/CourierPrime-Regular.ttf",
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, url in FONTS.items():
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        data = urllib.request.urlopen(req, timeout=120).read()
        (OUT / name).write_bytes(data)
        print(f"wrote {name} ({len(data)} bytes)")


if __name__ == "__main__":
    main()
