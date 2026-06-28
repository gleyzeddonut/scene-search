"""Color palettes (mockup oklch values approximated to hex) and the QSS builder.
GUI-free so it can be unit-tested without PySide6."""
from __future__ import annotations

TOKENS = (
    "app_bg", "chrome", "rail", "nav", "panel", "window",
    "border", "border_soft", "text", "text_2", "text_3",
    "accent", "accent_soft", "accent_text", "chip", "sel", "field",
    "w_bg", "w_fg", "m_bg", "m_fg",
)

LIGHT = {
    "app_bg": "#f1f1f4", "chrome": "#f6f6f8", "rail": "#fafafc", "nav": "#f3f3f6",
    "panel": "#f5f5f8", "window": "#fdfdff", "border": "#e3e3ea", "border_soft": "#ededf2",
    "text": "#2c2c38", "text_2": "#66667a", "text_3": "#9090a0",
    "accent": "#5b53e0", "accent_soft": "#ecebfb", "accent_text": "#5048c8",
    "chip": "#ececf1", "sel": "#eceaf9", "field": "#f0f0f4",
    "w_bg": "#f0c4bf", "w_fg": "#8a4a44", "m_bg": "#bdd1e8", "m_fg": "#3f5d80",
}

DARK = {
    "app_bg": "#15151c", "chrome": "#1b1b23", "rail": "#1d1d26", "nav": "#18181f",
    "panel": "#1d1d26", "window": "#22222c", "border": "#34343f", "border_soft": "#2a2a33",
    "text": "#e8e8ef", "text_2": "#b1b1c0", "text_3": "#85859a",
    "accent": "#8a7dff", "accent_soft": "#34306a", "accent_text": "#c3bdf5",
    "chip": "#2a2a33", "sel": "#34315e", "field": "#232330",
    "w_bg": "#7c4a48", "w_fg": "#f0cfca", "m_bg": "#46566e", "m_fg": "#cfdcec",
}


def palette_for(name: str) -> dict:
    return DARK if name == "dark" else LIGHT


def build_qss(p: dict) -> str:
    return f"""
    QWidget {{ background: {p['window']}; color: {p['text']};
        font-family: 'Space Grotesk', -apple-system, sans-serif; font-size: 13px; }}
    QMainWindow, #shell {{ background: {p['app_bg']}; }}
    #toolbar {{ background: {p['chrome']}; border-bottom: 1px solid {p['border']}; }}
    #navRail {{ background: {p['nav']}; border-right: 1px solid {p['border']}; }}
    #rail {{ background: {p['rail']}; border-right: 1px solid {p['border']}; }}
    #panel {{ background: {p['panel']}; }}
    #wordmark {{ font-size: 15px; font-weight: 700; }}
    QLineEdit {{ background: {p['field']}; border: 1px solid {p['border']};
        border-radius: 9px; padding: 6px 10px; color: {p['text']}; }}
    QPushButton {{ background: {p['chip']}; border: 1px solid {p['border']};
        border-radius: 8px; padding: 7px 12px; color: {p['text_2']}; }}
    QPushButton:hover {{ border-color: {p['accent']}; }}
    QPushButton#primary {{ background: {p['accent']}; color: white; border: none; }}
    QPushButton#navItem {{ background: transparent; border: none; color: {p['text_3']};
        border-radius: 9px; padding: 8px 4px; font-size: 10px; font-weight: 600; }}
    QPushButton#navItem:checked {{ background: {p['accent_soft']}; color: {p['accent_text']}; }}
    QTreeView, QListWidget {{ background: {p['window']}; border: none;
        outline: 0; alternate-background-color: {p['window']}; }}
    QTreeView::item, QListWidget::item {{ padding: 6px 8px; border-radius: 7px; }}
    QTreeView::item:selected, QListWidget::item:selected {{
        background: {p['sel']}; color: {p['text']}; }}
    QHeaderView::section {{ background: {p['window']}; color: {p['text_3']};
        border: none; border-bottom: 1px solid {p['border_soft']};
        padding: 6px 8px; font-size: 10px; }}
    QLabel#sectionLabel {{ color: {p['text_3']}; font-size: 10px; font-weight: 700; }}
    QLabel#mono {{ font-family: 'Courier Prime', monospace; color: {p['text_2']}; }}
    QScrollBar:vertical {{ background: transparent; width: 9px; }}
    QScrollBar::handle:vertical {{ background: {p['border']}; border-radius: 4px; }}
    """
