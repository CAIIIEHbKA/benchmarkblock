import csv
import json
import os
from datetime import datetime

from PyQt6.QtCore import Qt, QThread, pyqtSignal
from PyQt6.QtGui import QColor
from PyQt6.QtWidgets import (
    QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QPushButton,
    QTableWidget, QTableWidgetItem, QHeaderView, QLabel, QProgressBar,
    QMessageBox, QTabWidget, QTextEdit, QAbstractItemView,
)

from core.models import SiteResult, YouTubeResult, Status, BenchmarkSummary
from core.tester import SiteTester
from core.youtube_tester import YouTubeTester
from ui.youtube_widgets import YouTubePanel
from ui.score_dialog import ScoreDialog


class BenchmarkWorker(QThread):
    """Фоновый поток для полного бенчмарка."""
    site_done = pyqtSignal(object)
    youtube_done = pyqtSignal(object)
    youtube_progress = pyqtSignal(str, int, int)
    finished_all = pyqtSignal(object)

    def __init__(self, sites, youtube_config):
        super().__init__()
        self._sites = sites
        self._youtube_config = youtube_config

    def run(self):
        import time as _time
        start_total = _time.perf_counter()

        tester = SiteTester()
        site_results = tester.test_sites_parallel(
            self._sites,
            callback=lambda r: self.site_done.emit(r),
        )

        yt_tester = YouTubeTester(self._youtube_config)
        youtube_result = yt_tester.test_youtube(
            progress_callback=lambda d, i, t: self.youtube_progress.emit(d, i, t)
        )
        self.youtube_done.emit(youtube_result)

        summary = BenchmarkSummary()
        summary.site_results = site_results
        summary.youtube = youtube_result
        summary.total_sites = len(site_results)
        summary.accessible = sum(1 for r in site_results if r.status in (Status.OK, Status.PARTIAL))
        summary.blocked = sum(1 for r in site_results if r.status == Status.BLOCKED)
        summary.timeout = sum(1 for r in site_results if r.status == Status.TIMEOUT)
        summary.errors = sum(1 for r in site_results if r.status == Status.ERROR)
        summary.total_time_ms = (_time.perf_counter() - start_total) * 1000

        self.finished_all.emit(summary)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Бенчмарк доступа к заблокированным сайтам (РФ)")
        self.resize(1000, 720)

        self._config = self._load_config()
        self._sites = [(s["name"], s["url"]) for s in self._config["general"]]
        self._youtube_config = self._config["youtube"]

        self._site_rows = {}
        self._worker = None
        self._summary = None
        self._done_steps = 0

        self._build_ui()

    def _load_config(self):
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "sites.json")
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)

        top = QHBoxLayout()
        self.start_btn = QPushButton("▶ Запустить бенчмарк")
        self.start_btn.clicked.connect(self._on_start)
        self.start_btn.setMinimumHeight(36)
        self.export_btn = QPushButton("💾 Экспорт CSV")
        self.export_btn.clicked.connect(self._on_export)
        self.export_btn.setEnabled(False)

        top.addWidget(self.start_btn)
        top.addWidget(self.export_btn)
        top.addStretch()

        self.status_label = QLabel("Готов к запуску")
        self.status_label.setStyleSheet("font-weight: bold;")
        top.addWidget(self.status_label)
        layout.addLayout(top)

        self.progress = QProgressBar()
        self.progress.setRange(0, 100)
        self.progress.setValue(0)
        layout.addWidget(self.progress)

        tabs = QTabWidget()
        layout.addWidget(tabs)

        sites_tab = QWidget()
        sites_layout = QVBoxLayout(sites_tab)
        self.table = QTableWidget()
        self.table.setColumnCount(5)
        self.table.setHorizontalHeaderLabels(["Сайт", "URL", "Статус", "HTTP", "Время (мс)"])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setAlternatingRowColors(True)

        self.table.setRowCount(len(self._sites))
        for row, (name, url) in enumerate(self._sites):
            self._site_rows[name] = row
            self.table.setItem(row, 0, QTableWidgetItem(name))
            self.table.setItem(row, 1, QTableWidgetItem(url))
            for col in (2, 3, 4):
                self.table.setItem(row, col, QTableWidgetItem("—"))

        sites_layout.addWidget(self.table)
        tabs.addTab(sites_tab, "Сайты")

        yt_tab = QWidget()
        yt_layout = QVBoxLayout(yt_tab)
        self.yt_panel = YouTubePanel()
        yt_layout.addWidget(self.yt_panel)
        tabs.addTab(yt_tab, "YouTube")

        summary_tab = QWidget()
        summary_layout = QVBoxLayout(summary_tab)
        self.summary_text = QTextEdit()
        self.summary_text.setReadOnly(True)
        summary_layout.addWidget(self.summary_text)
        tabs.addTab(summary_tab, "Сводка")

    def _on_start(self):
        if self._worker and self._worker.isRunning():
            return

        self.start_btn.setEnabled(False)
        self.export_btn.setEnabled(False)
        self.progress.setValue(0)
        self.status_label.setText("Выполняется...")

        for name in self._site_rows:
            row = self._site_rows[name]
            for col in (2, 3, 4):
                self.table.setItem(row, col, QTableWidgetItem("…"))

        self.yt_panel.reset()
        self.summary_text.clear()
        self._summary = None
        self._done_steps = 0

        total_steps = len(self._sites) + 1

        self._worker = BenchmarkWorker(self._sites, self._youtube_config)
        self._worker.site_done.connect(lambda r: self._on_site_done(r, total_steps))
        self._worker.youtube_done.connect(lambda r: self._on_youtube_done(r, total_steps))
        self._worker.youtube_progress.connect(self.yt_panel.update_progress)
        self._worker.youtube_progress.connect(self.yt_panel.update_progress)
        self._worker.youtube_progress.connect(self.yt_panel.update_progress)
        self._worker.finished_all.connect(self._on_finished)
        self._worker.start()

    def _on_site_done(self, result: SiteResult, total_steps: int):
        self._done_steps += 1
        self.progress.setValue(int(self._done_steps / total_steps * 100))

        row = self._site_rows.get(result.name)
        if row is None:
            return

        status_item = QTableWidgetItem(result.display_status)
        status_item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
        status_item.setForeground(self._status_color(result.status))

        self.table.setItem(row, 2, status_item)
        self.table.setItem(row, 3, QTableWidgetItem(str(result.http_code or "—")))
        self.table.setItem(row, 4, QTableWidgetItem(str(result.response_time_ms or "—")))

    def _on_youtube_done(self, result: YouTubeResult, total_steps: int):
        self._done_steps += 1
        self.progress.setValue(int(self._done_steps / total_steps * 100))
        self.yt_panel.update_result(result)

    def _on_finished(self, summary: BenchmarkSummary):
        self._summary = summary
        self.start_btn.setEnabled(True)
        self.export_btn.setEnabled(True)
        self.progress.setValue(100)
        self.status_label.setText("Готово")
        self._render_summary(summary)

        score, max_score, verdict, congrats = self._calculate_score(summary)
        dialog = ScoreDialog(
            score=score,
            max_score=max_score,
            verdict=verdict,
            congrats=congrats,
            accessible=summary.accessible,
            blocked=summary.blocked,
            timeout=summary.timeout,
            errors=summary.errors,
            parent=self,
        )
        dialog.exec()

    @staticmethod
    def _status_color(status: Status) -> QColor:
        mapping = {
            Status.OK: QColor("#1a7f37"),
            Status.BLOCKED: QColor("#d1242f"),
            Status.TIMEOUT: QColor("#bf8700"),
            Status.ERROR: QColor("#d1242f"),
            Status.PARTIAL: QColor("#bf8700"),
        }
        return mapping.get(status, QColor("#666666"))

    def _calculate_score(self, s: BenchmarkSummary) -> tuple[int, int, str, str]:
        """Рассчитывает скор (попугаев). Возвращает (баллы, максимум, вердикт, поздравление)."""
        total_sites = s.total_sites
        accessible_sites = s.accessible
        yt = s.youtube

        # Веса: сайты — 60%, YouTube — 40%
        site_score = (accessible_sites / total_sites * 60) if total_sites else 0
        yt_score = 0
        if yt and yt.total_domains > 0:
            yt_score = (yt.opened_count / yt.total_domains * 40)

        total_score = site_score + yt_score
        max_score = 100

        # Категория попугаев
        if total_score >= 90:
            parrots = "🦜🦜🦜🦜🦜"
            verdict = "ПОЛНЫЙ ФАРШ! Интернет свободен!"
            congrats = "Поздравляем! Все сайты и YouTube доступны. Цензура обойдена полностью!"
        elif total_score >= 70:
            parrots = "🦜🦜🦜🦜"
            verdict = "ОТЛИЧНО! VPN/прокси работает отлично."
            congrats = "Большинство сайтов и YouTube открыты. Свободный интернет почти у тебя в кармане!"
        elif total_score >= 40:
            parrots = "🦜🦜🦜"
            verdict = "СРЕДНЕ. Частичный обход блокировок."
            congrats = "Половина интернета доступна. Можно лучше — попробуй другой VPN или настройки DPI."
        elif total_score >= 15:
            parrots = "🦜🦜"
            verdict = "ПЛОХО. Почти всё заблокировано."
            congrats = "Свободный интернет в зачаточном состоянии. Нужен хороший VPN!"
        else:
            parrots = "🦜"
            verdict = "ДНО. Тотальная цензура."
            congrats = "Интернет полностью в клетке. Срочно включай VPN, пока не поздно!"

        return round(total_score, 1), max_score, verdict, congrats

    def _render_summary(self, s: BenchmarkSummary):
        lines = [
            "=" * 50,
            "          СВОДКА БЕНЧМАРКА",
            "=" * 50,
            f"Время запуска: {s.timestamp}",
            "",
            f"Всего сайтов протестировано: {s.total_sites}",
            f"  ✅ Доступны: {s.accessible}",
            f"  ❌ Заблокированы: {s.blocked}",
            f"  ⏱ Таймаут: {s.timeout}",
            f"  ⚠ Ошибки: {s.errors}",
            f"Общее время теста: {s.total_time_ms:.0f} мс",
            "",
        ]

        if s.youtube:
            y = s.youtube
            lines.append("-" * 50)
            lines.append("YouTube:")
            lines.append(f"  Статус: {y.display_status}")
            lines.append(f"  Открылись: {y.opened_count} / {y.total_domains}")
            lines.append(f"  Не открылись: {y.failed_count}")

        # Скоринг
        score, max_score, verdict, congrats = self._calculate_score(s)
        parrots = "🦜" * round(score / 20) if score > 0 else "🦜"
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

        lines.append("")
        lines.append("=" * 50)
        lines.append(f"  СКОР: {score:.1f} / {max_score} попугаев")
        lines.append(f"  {parrots}")
        lines.append("=" * 50)
        lines.append(f"ВЕРДИКТ: {verdict}")
        lines.append("")
        lines.append(congrats)
        lines.append("")

        self.summary_text.setPlainText("\n".join(lines))

    def _on_export(self):
        if not self._summary:
            QMessageBox.warning(self, "Экспорт", "Нет данных для экспорта.")
            return

        filename = f"benchmark_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        path = os.path.join(os.getcwd(), filename)

        with open(path, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f, delimiter=";")
            writer.writerow(["Сайт", "URL", "Статус", "HTTP код", "Время (мс)", "Ошибка", "Время замера"])
            for r in self._summary.site_results:
                writer.writerow([
                    r.name, r.url, r.display_status, r.http_code or "",
                    r.response_time_ms or "", r.error_message or "", r.timestamp,
                ])

            if self._summary.youtube:
                y = self._summary.youtube
                writer.writerow([])
                writer.writerow(["=== YouTube ==="])
                writer.writerow(["Параметр", "Значение"])
                writer.writerow(["Статус", y.display_status])
                writer.writerow(["Всего доменов", y.total_domains])
                writer.writerow(["Открылись", y.opened_count])
                writer.writerow(["Не открылись", y.failed_count])
                writer.writerow([])
                writer.writerow(["Открытые домены", ""])
                for d in y.opened_domains:
                    writer.writerow([d, "✅"])
                writer.writerow([])
                writer.writerow(["Закрытые домены", ""])
                for d in y.failed_domains:
                    writer.writerow([d, "❌"])

        QMessageBox.information(self, "Экспорт", f"Файл сохранён:\n{path}")

    def closeEvent(self, event):
        if self._worker and self._worker.isRunning():
            self._worker.quit()
            self._worker.wait(2000)
        event.accept()
