from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, QSize, Signal
from PySide6.QtGui import QFontDatabase
from PySide6.QtWidgets import (
    QButtonGroup,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QStackedWidget,
    QToolButton,
    QVBoxLayout,
    QWidget,
)

from ..theme import build_qss, palette_for
from .icons import icon as make_icon


def load_app_fonts() -> None:
    fonts_dir = Path(__file__).resolve().parent.parent / "fonts"
    for ttf in ("SpaceGrotesk.ttf", "CourierPrime.ttf"):
        path = fonts_dir / ttf
        if path.exists():
            QFontDatabase.addApplicationFont(str(path))


class AppShell(QWidget):
    searchChanged = Signal(str)
    themeChanged = Signal()

    def __init__(self, settings):
        super().__init__()
        self.setObjectName("shell")
        self._settings = settings
        self._views: dict[str, int] = {}
        self._nav_buttons: list[tuple[QToolButton, str]] = []
        self._nav_group = QButtonGroup(self)
        self._build_ui()
        self.apply_theme()

    @property
    def _palette(self):
        return palette_for(self._settings.get_theme())

    def _build_ui(self) -> None:
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # ---- toolbar ----
        toolbar = QWidget()
        toolbar.setObjectName("toolbar")
        toolbar.setFixedHeight(50)
        tb = QHBoxLayout(toolbar)
        tb.setContentsMargins(16, 0, 16, 0)
        tb.setSpacing(9)
        self.brand_dot = QLabel()
        self.brand_dot.setObjectName("brandDot")
        self.brand_dot.setFixedSize(17, 17)
        self.wordmark = QLabel("Scripty")
        self.wordmark.setObjectName("wordmark")
        tb.addWidget(self.brand_dot)
        tb.addWidget(self.wordmark)
        tb.addStretch(1)

        search = QWidget()
        search.setObjectName("searchField")
        search.setFixedWidth(400)
        sl = QHBoxLayout(search)
        sl.setContentsMargins(11, 6, 9, 6)
        sl.setSpacing(8)
        self.search_icon = QLabel()
        self.search_edit = QLineEdit()
        self.search_edit.setPlaceholderText("Search scenes, characters…")
        self.search_edit.textChanged.connect(self.searchChanged.emit)
        kbd = QLabel("⌘K")
        kbd.setObjectName("kbd")
        sl.addWidget(self.search_icon)
        sl.addWidget(self.search_edit, 1)
        sl.addWidget(kbd)
        tb.addWidget(search)
        tb.addStretch(1)

        seg = QWidget()
        seg.setObjectName("segToggle")
        sg = QHBoxLayout(seg)
        sg.setContentsMargins(2, 2, 2, 2)
        sg.setSpacing(2)
        self._light_btn = QPushButton("☀")
        self._dark_btn = QPushButton("☾")
        toggle_group = QButtonGroup(self)
        for b, name in ((self._light_btn, "light"), (self._dark_btn, "dark")):
            b.setCheckable(True)
            b.setFixedWidth(34)
            b.clicked.connect(lambda _=False, n=name: self._set_theme(n))
            toggle_group.addButton(b)
            sg.addWidget(b)
        tb.addWidget(seg)
        root.addWidget(toolbar)

        # ---- body: nav rail + stack ----
        body = QHBoxLayout()
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(0)
        rail = QWidget()
        rail.setObjectName("navRail")
        rail.setFixedWidth(76)
        self._rail_layout = QVBoxLayout(rail)
        self._rail_layout.setContentsMargins(10, 14, 10, 14)
        self._rail_layout.setSpacing(6)
        self._rail_layout.addStretch(1)
        body.addWidget(rail)
        self.stack = QStackedWidget()
        body.addWidget(self.stack, 1)
        root.addLayout(body, 1)

    def add_view(self, key: str, widget: QWidget, label: str, icon_name: str) -> None:
        idx = self.stack.addWidget(widget)
        self._views[key] = idx
        btn = QToolButton()
        btn.setObjectName("navItem")
        btn.setText(label)
        btn.setCheckable(True)
        btn.setToolButtonStyle(Qt.ToolButtonTextUnderIcon)
        btn.setIconSize(QSize(20, 20))
        btn.setFixedSize(56, 50)
        btn.clicked.connect(lambda: self.show_view(key))
        self._nav_group.addButton(btn)
        self._nav_buttons.append((btn, icon_name))
        self._rail_layout.insertWidget(self._rail_layout.count() - 1, btn, 0, Qt.AlignHCenter)
        if self.stack.count() == 1:
            btn.setChecked(True)

    def show_view(self, key: str) -> None:
        if key in self._views:
            self.stack.setCurrentIndex(self._views[key])

    def _set_theme(self, name: str) -> None:
        self._settings.set_theme(name)
        self.apply_theme()
        self.themeChanged.emit()

    def apply_theme(self) -> None:
        p = self._palette
        win = self.window()
        (win or self).setStyleSheet(build_qss(p))
        # icons + toggle state recolored for the current theme
        self.search_icon.setPixmap(make_icon("search", p["text_3"], 15).pixmap(15, 15))
        for btn, icon_name in self._nav_buttons:
            color = p["accent_text"] if btn.isChecked() else p["text_3"]
            btn.setIcon(make_icon(icon_name, color, 20))
        self._light_btn.setChecked(self._settings.get_theme() == "light")
        self._dark_btn.setChecked(self._settings.get_theme() == "dark")
