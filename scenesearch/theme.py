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
    QWidget {{ background: transparent; color: {p['text']};
        font-family: 'Space Grotesk', -apple-system, sans-serif; font-size: 13px; }}
    QMainWindow, #shell {{ background: {p['app_bg']}; }}
    QLabel {{ background: transparent; }}
    QToolTip {{ background: {p['window']}; color: {p['text']};
        border: 1px solid {p['border']}; padding: 4px 7px; border-radius: 6px; }}

    /* ---- toolbar ---- */
    #toolbar {{ background: {p['chrome']}; border-bottom: 1px solid {p['border']}; }}
    #wordmark {{ font-size: 15px; font-weight: 700; color: {p['text']}; }}
    #brandDot {{ background: {p['accent']}; border-radius: 5px; }}
    #searchField {{ background: {p['field']}; border: 1px solid {p['border']};
        border-radius: 9px; }}
    #searchField QLineEdit {{ background: transparent; border: none; padding: 0; }}
    #kbd {{ color: {p['text_3']}; border: 1px solid {p['border']}; border-radius: 5px;
        padding: 2px 5px; font-size: 11px; font-weight: 600; }}
    #segToggle {{ border: 1px solid {p['border']}; border-radius: 8px; }}
    #segToggle QPushButton {{ background: transparent; border: none; border-radius: 6px;
        padding: 4px 9px; color: {p['text_3']}; font-size: 13px; }}
    #segToggle QPushButton:checked {{ background: {p['accent']}; color: white; }}

    /* ---- nav rail ---- */
    #navRail {{ background: {p['nav']}; border-right: 1px solid {p['border']}; }}
    #navItem {{ background: transparent; border: none; color: {p['text_3']};
        border-radius: 12px; font-size: 9px; font-weight: 700; }}
    #navItem:hover {{ background: {p['border_soft']}; }}
    #navItem:checked {{ background: {p['accent_soft']}; color: {p['accent_text']}; }}

    /* ---- panes ---- */
    #rail {{ background: {p['rail']}; border-right: 1px solid {p['border']}; }}
    #listPane {{ background: {p['window']}; border-right: 1px solid {p['border']}; }}
    #panel {{ background: {p['panel']}; border-left: 1px solid {p['border']}; }}
    #listHeader {{ background: {p['window']}; border-bottom: 1px solid {p['border']}; }}

    /* ---- filter sections ---- */
    QLabel#sectionLabel {{ color: {p['text_3']}; font-size: 10px; font-weight: 700;
        letter-spacing: 1px; }}
    #filterSection {{ border-bottom: 1px solid {p['border_soft']}; }}

    /* ---- chips / segmented filter buttons ---- */
    QPushButton#chip {{ background: {p['chip']}; border: 1px solid transparent;
        border-radius: 999px; padding: 6px 13px; color: {p['text_2']};
        font-size: 12px; font-weight: 600; }}
    QPushButton#chip:hover {{ border-color: {p['border']}; }}
    QPushButton#chip:checked {{ background: {p['accent_soft']}; color: {p['accent_text']};
        border-color: transparent; }}

    /* ---- generic buttons ---- */
    QPushButton {{ background: {p['chip']}; border: 1px solid {p['border']};
        border-radius: 9px; padding: 8px 14px; color: {p['text_2']}; font-weight: 600; }}
    QPushButton:hover {{ border-color: {p['accent']}; color: {p['text']}; }}
    QPushButton#primary {{ background: {p['accent']}; color: white; border: none;
        font-weight: 700; }}
    QPushButton#primary:hover {{ background: {p['accent_text']}; }}

    /* ---- inputs ---- */
    QLineEdit {{ background: {p['field']}; border: 1px solid {p['border']};
        border-radius: 9px; padding: 7px 11px; color: {p['text']}; selection-background-color: {p['accent_soft']}; }}
    QLineEdit:focus {{ border-color: {p['accent']}; }}

    /* ---- cards ---- */
    #statCard {{ background: {p['panel']}; border: 1px solid {p['border']};
        border-radius: 12px; }}
    #scriptCard {{ background: {p['window']}; border: 1px solid {p['border']};
        border-radius: 11px; }}
    #detailTitle {{ font-size: 22px; font-weight: 700; color: {p['text']}; }}
    #tagChip {{ background: {p['chip']}; color: {p['text_2']}; border-radius: 999px;
        padding: 5px 11px; font-size: 11px; font-weight: 600; }}

    /* ---- list ---- */
    QListWidget {{ background: {p['window']}; border: none; outline: 0; }}
    QListWidget::item {{ border-radius: 9px; margin: 1px 8px; }}
    QListWidget::item:selected {{ background: {p['sel']}; }}
    QListWidget::item:hover {{ background: {p['border_soft']}; }}
    QFrame#folderList {{ background: {p['window']}; border: 1px solid {p['border']};
        border-radius: 12px; }}

    /* ---- text helpers ---- */
    QLabel#mono {{ font-family: 'Courier Prime', monospace; color: {p['text_2']}; }}
    QLabel#muted {{ color: {p['text_3']}; font-size: 12px; }}
    QTextEdit {{ background: {p['window']}; border: 1px solid {p['border']};
        border-radius: 11px; padding: 14px; color: {p['text']};
        font-family: 'Courier Prime', monospace; }}

    /* ---- scrollbars ---- */
    QScrollBar:vertical {{ background: transparent; width: 10px; margin: 2px; }}
    QScrollBar::handle:vertical {{ background: {p['border']}; border-radius: 4px; min-height: 30px; }}
    QScrollBar::handle:vertical:hover {{ background: {p['text_3']}; }}
    QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; }}
    QScrollBar:horizontal {{ height: 0; }}
    """
