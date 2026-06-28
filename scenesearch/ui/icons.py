from __future__ import annotations

from PySide6.QtCore import QByteArray, Qt
from PySide6.QtGui import QIcon, QPainter, QPixmap

try:
    from PySide6.QtSvg import QSvgRenderer
    _HAVE_SVG = True
except Exception:  # pragma: no cover
    _HAVE_SVG = False

# Stroke/fill SVGs from the design (currentColor recolored at render time).
_ICONS = {
    "browse": '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" '
              'stroke-linecap="round"><circle cx="9" cy="9" r="6"/><line x1="13.5" y1="13.5" x2="17.5" y2="17.5"/></svg>',
    "prepare": '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M6 4.5 L16 10 L6 15.5 Z"/></svg>',
    "library": '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" '
               'stroke-linejoin="round"><rect x="3" y="6" width="14" height="10" rx="1.6"/>'
               '<rect x="3" y="3.5" width="7" height="3" rx="1"/></svg>',
    "search": '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" '
              'stroke-linecap="round"><circle cx="9" cy="9" r="6"/><line x1="13.5" y1="13.5" x2="17.5" y2="17.5"/></svg>',
}


def icon(name: str, color: str, size: int = 20) -> QIcon:
    svg = _ICONS.get(name, "")
    pix = QPixmap(size, size)
    pix.fill(Qt.transparent)
    if svg and _HAVE_SVG:
        renderer = QSvgRenderer(QByteArray(svg.replace("currentColor", color).encode()))
        painter = QPainter(pix)
        renderer.render(painter)
        painter.end()
    return QIcon(pix)
