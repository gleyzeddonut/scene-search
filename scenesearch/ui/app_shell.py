from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Signal
from PySide6.QtGui import QFontDatabase
from PySide6.QtWidgets import (
    QButtonGroup,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from ..theme import build_qss, palette_for


def load_app_fonts() -> None:
    fonts_dir = Path(__file__).resolve().parent.parent / "fonts"
    for ttf in ("SpaceGrotesk.ttf", "CourierPrime.ttf"):
        path = fonts_dir / ttf
        if path.exists():
            QFontDatabase.addApplicationFont(str(path))


def settings_dark(settings) -> bool:
    return settings.get_theme() == "dark"


class AppShell(QWidget):
    searchChanged = Signal(str)

    def __init__(self, settings):
        super().__init__()
        self.setObjectName("shell")
        self._settings = settings
        self._views: dict[str, int] = {}
        self._nav_group = QButtonGroup(self)
        self._build_ui()
        self.apply_theme()

    def _build_ui(self) -> None:
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        toolbar = QWidget()
        toolbar.setObjectName("toolbar")
        toolbar.setFixedHeight(48)
        tb = QHBoxLayout(toolbar)
        tb.setContentsMargins(16, 0, 16, 0)
        dot = QLabel("●")
        self.wordmark = QLabel("Scripty")
        self.wordmark.setObjectName("wordmark")
        self.search_edit = QLineEdit()
        self.search_edit.setPlaceholderText("Search scenes, characters…")
        self.search_edit.setFixedWidth(360)
        self.search_edit.textChanged.connect(self.searchChanged.emit)
        self.theme_toggle = QPushButton("☾" if settings_dark(self._settings) else "☀")
        self.theme_toggle.setFixedWidth(40)
        self.theme_toggle.clicked.connect(self._toggle_theme)
        tb.addWidget(dot)
        tb.addWidget(self.wordmark)
        tb.addStretch(1)
        tb.addWidget(self.search_edit)
        tb.addStretch(1)
        tb.addWidget(self.theme_toggle)
        root.addWidget(toolbar)

        body = QHBoxLayout()
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(0)
        rail = QWidget()
        rail.setObjectName("navRail")
        rail.setFixedWidth(74)
        self._rail_layout = QVBoxLayout(rail)
        self._rail_layout.setContentsMargins(8, 12, 8, 12)
        self._rail_layout.setSpacing(6)
        self._rail_layout.addStretch(1)
        body.addWidget(rail)
        self.stack = QStackedWidget()
        body.addWidget(self.stack, 1)
        root.addLayout(body, 1)

    def add_view(self, key: str, widget: QWidget, label: str) -> None:
        idx = self.stack.addWidget(widget)
        self._views[key] = idx
        btn = QPushButton(label)
        btn.setObjectName("navItem")
        btn.setCheckable(True)
        btn.clicked.connect(lambda: self.show_view(key))
        self._nav_group.addButton(btn)
        self._rail_layout.insertWidget(self._rail_layout.count() - 1, btn)
        if self.stack.count() == 1:
            btn.setChecked(True)

    def show_view(self, key: str) -> None:
        if key in self._views:
            self.stack.setCurrentIndex(self._views[key])

    def _toggle_theme(self) -> None:
        new = "light" if self._settings.get_theme() == "dark" else "dark"
        self._settings.set_theme(new)
        self.theme_toggle.setText("☾" if new == "dark" else "☀")
        self.apply_theme()

    def apply_theme(self) -> None:
        qss = build_qss(palette_for(self._settings.get_theme()))
        win = self.window()
        (win or self).setStyleSheet(qss)
