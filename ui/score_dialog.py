from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QFrame,
)


class ScoreDialog(QDialog):
    """Красивое финальное окно со скором и попугаями."""

    def __init__(self, score: float, max_score: int, verdict: str, congrats: str,
                 accessible: int, blocked: int, timeout: int, errors: int,
                 parent=None):
        super().__init__(parent)
        self.setWindowTitle("🎉 Результат бенчмарка")
        self.setFixedSize(520, 480)
        self.setModal(True)

        # Фон в зависимости от скора
        if score >= 90:
            bg = "#e8f8e8"
            border = "#1a7f37"
            emoji = "🏆"
        elif score >= 70:
            bg = "#e8f5e9"
            border = "#2e7d32"
            emoji = "🎉"
        elif score >= 40:
            bg = "#fff8e1"
            border = "#bf8700"
            emoji = "👍"
        elif score >= 15:
            bg = "#fff3e0"
            border = "#e65100"
            emoji = "⚠️"
        else:
            bg = "#ffebee"
            border = "#c62828"
            emoji = "🔒"

        self.setStyleSheet(f"""
            QDialog {{
                background-color: {bg};
                border: 3px solid {border};
                border-radius: 16px;
            }}
        """)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(30, 25, 30, 25)
        layout.setSpacing(14)

        # Эмодзи
        emoji_label = QLabel(emoji)
        emoji_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        emoji_label.setStyleSheet("font-size: 60px; border: none;")
        layout.addWidget(emoji_label)

        # Заголовок
        title = QLabel("ТЕСТ ЗАВЕРШЁН!")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setStyleSheet("font-size: 24px; font-weight: bold; color: #333; border: none;")
        layout.addWidget(title)

        # Скор крупно
        score_label = QLabel(f"{score:.1f} / {max_score}")
        score_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        score_label.setStyleSheet(f"font-size: 52px; font-weight: bold; color: {border}; border: none;")
        layout.addWidget(score_label)

        # Попугаи
        if score >= 90:
            parrots = "🦜🦜🦜🦜🦜"
        elif score >= 70:
            parrots = "🦜🦜🦜🦜"
        elif score >= 40:
            parrots = "🦜🦜🦜"
        elif score >= 15:
            parrots = "🦜🦜"
        else:
            parrots = "🦜"
        parrots_label = QLabel(parrots)
        parrots_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        parrots_label.setStyleSheet("font-size: 42px; border: none;")
        layout.addWidget(parrots_label)

        # Вердикт
        verdict_label = QLabel(verdict)
        verdict_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        verdict_label.setWordWrap(True)
        verdict_label.setStyleSheet(f"font-size: 16px; font-weight: bold; color: {border}; border: none;")
        layout.addWidget(verdict_label)

        # Поздравление
        congrats_label = QLabel(congrats)
        congrats_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        congrats_label.setWordWrap(True)
        congrats_label.setStyleSheet("font-size: 13px; color: #555; border: none;")
        layout.addWidget(congrats_label)

        # Разделитель
        line = QFrame()
        line.setFrameShape(QFrame.Shape.HLine)
        line.setStyleSheet("color: #ccc;")
        layout.addWidget(line)

        # Статистика
        stats = QLabel(
            f"✅ Доступны: {accessible}    "
            f"❌ Заблокированы: {blocked}\n"
            f"⏱ Таймаут: {timeout}    "
            f"⚠ Ошибки: {errors}"
        )
        stats.setAlignment(Qt.AlignmentFlag.AlignCenter)
        stats.setStyleSheet("font-size: 14px; color: #444; border: none;")
        layout.addWidget(stats)

        # Кнопка OK
        btn_layout = QHBoxLayout()
        btn_layout.addStretch()
        ok_btn = QPushButton("  OK  ")
        ok_btn.setMinimumSize(120, 44)
        ok_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: {border};
                color: white;
                border: none;
                border-radius: 22px;
                font-size: 16px;
                font-weight: bold;
            }}
            QPushButton:hover {{
                background-color: {border};
                opacity: 0.9;
            }}
        """)
        ok_btn.clicked.connect(self.accept)
        btn_layout.addWidget(ok_btn)
        btn_layout.addStretch()
        layout.addLayout(btn_layout)
