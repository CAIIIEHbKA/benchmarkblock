from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (
    QFrame, QVBoxLayout, QHBoxLayout, QLabel, QWidget,
    QGridLayout, QSizePolicy, QTreeWidget, QTreeWidgetItem,
)


class YouTubePanel(QWidget):
    """Панель YouTube с подробным списком доменов."""

    def __init__(self):
        super().__init__()
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(12, 12, 12, 12)
        main_layout.setSpacing(10)

        header = QLabel("🎬  YouTube — подробный тест доменов")
        header.setStyleSheet("font-size: 18px; font-weight: bold;")
        main_layout.addWidget(header)

        self.counter = QLabel("Проверено: 0 / 0")
        self.counter.setStyleSheet("font-size: 14px; color: #555;")
        main_layout.addWidget(self.counter)

        self.summary_label = QLabel("")
        self.summary_label.setStyleSheet("font-size: 14px; font-weight: bold;")
        main_layout.addWidget(self.summary_label)

        self.tree = QTreeWidget()
        self.tree.setHeaderLabels(["Домен", "Статус"])
        self.tree.setAlternatingRowColors(True)
        self.tree.setColumnWidth(0, 500)
        main_layout.addWidget(self.tree)

        self.reset()

    def reset(self):
        """Сбрасывает панель."""
        self.tree.clear()
        self.counter.setText("Проверено: 0 / 0")
        self.summary_label.setText("")

        opened_item = QTreeWidgetItem(["Открылись", ""])
        opened_item.setForeground(0, Qt.GlobalColor.darkGreen)
        failed_item = QTreeWidgetItem(["Не открылись", ""])
        failed_item.setForeground(0, Qt.GlobalColor.darkRed)
        self.tree.addTopLevelItem(opened_item)
        self.tree.addTopLevelItem(failed_item)
        self.tree.expandAll()

    def update_progress(self, domain: str, done: int, total: int):
        """Обновляет счётчик при проверке домена."""
        self.counter.setText(f"Проверено: {done} / {total}")

    def update_result(self, result):
        """Заполняет дерево результатами."""
        self.tree.clear()
        self.counter.setText(f"Проверено: {result.total_domains} / {result.total_domains}")

        opened_count = result.opened_count
        failed_count = result.failed_count
        self.summary_label.setText(
            f"✅ Открылись: {opened_count}  |  ❌ Не открылись: {failed_count}"
        )

        opened_item = QTreeWidgetItem([f"Открылись · {opened_count}", ""])
        opened_item.setForeground(0, Qt.GlobalColor.darkGreen)
        for d in result.opened_domains:
            child = QTreeWidgetItem([d, "✅"])
            child.setForeground(0, Qt.GlobalColor.darkGreen)
            opened_item.addChild(child)

        failed_item = QTreeWidgetItem([f"Не открылись · {failed_count}", ""])
        failed_item.setForeground(0, Qt.GlobalColor.darkRed)
        for d in result.failed_domains:
            child = QTreeWidgetItem([d, "❌"])
            child.setForeground(0, Qt.GlobalColor.darkRed)
            failed_item.addChild(child)

        self.tree.addTopLevelItem(opened_item)
        self.tree.addTopLevelItem(failed_item)
        self.tree.expandAll()
