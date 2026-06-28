from __future__ import annotations

from PySide6.QtWidgets import (
    QCheckBox,
    QDialog,
    QDialogButtonBox,
    QLabel,
    QVBoxLayout,
)


class SettingsDialog(QDialog):
    """App settings. Currently just the update-on-launch toggle (more later)."""

    def __init__(self, settings, parent=None):
        super().__init__(parent)
        self._settings = settings
        self.setWindowTitle("Settings")
        self.setMinimumWidth(360)

        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("Updates"))

        self.check_updates_box = QCheckBox("Check for updates on launch")
        self.check_updates_box.setChecked(settings.get_check_updates())
        self.check_updates_box.toggled.connect(settings.set_check_updates)
        layout.addWidget(self.check_updates_box)

        layout.addStretch(1)
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        buttons.rejected.connect(self.accept)
        buttons.accepted.connect(self.accept)
        layout.addWidget(buttons)
