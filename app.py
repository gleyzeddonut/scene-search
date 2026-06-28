import sys


def _selfcheck() -> int:
    """Verify bundled resources load inside a frozen build (no GUI)."""
    from scenesearch.screenplay.gender import _load_table, guess_gender

    table = _load_table()
    print(f"names table entries: {len(table)}")
    print(f"guess_gender('John') = {guess_gender('John')}")
    print(f"guess_gender('Mary') = {guess_gender('Mary')}")
    ok = len(table) > 1000 and guess_gender("John") == "male"
    print("selfcheck:", "OK" if ok else "FAILED")
    return 0 if ok else 1


def main() -> None:
    if "--selfcheck" in sys.argv:
        sys.exit(_selfcheck())

    from PySide6.QtWidgets import QApplication

    from scenesearch.ui.main_window import MainWindow

    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
