from __future__ import annotations

from PySide6.QtWidgets import QHBoxLayout, QLabel, QPushButton, QWidget


class UpdateBanner(QWidget):
    """Thin banner shown only when an update is relevant."""

    def __init__(self):
        super().__init__()
        self.setStyleSheet("background:#2d4a7a; color:white;")
        layout = QHBoxLayout(self)
        layout.setContentsMargins(10, 4, 10, 4)
        self.message_label = QLabel("")
        self.action_button = QPushButton("")
        layout.addWidget(self.message_label, 1)
        layout.addWidget(self.action_button)
        self.setVisible(False)

    def show_available(self, version: str) -> None:
        self.message_label.setText(f"Update available: v{version}")
        self.action_button.setText("Update")
        self.action_button.setVisible(True)
        self.setVisible(True)

    def show_downloading(self, percent: int) -> None:
        self.message_label.setText(f"Downloading update… {percent}%")
        self.action_button.setVisible(False)
        self.setVisible(True)

    def show_ready(self) -> None:
        self.message_label.setText("Update downloaded.")
        self.action_button.setText("Relaunch to finish")
        self.action_button.setVisible(True)
        self.setVisible(True)

    def show_message(self, text: str) -> None:
        self.message_label.setText(text)
        self.action_button.setVisible(False)
        self.setVisible(True)
