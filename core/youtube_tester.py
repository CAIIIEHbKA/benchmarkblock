import re
import time
import requests
from typing import Callable

from .models import YouTubeResult, Status


class YouTubeTester:
    """Тестирует доступность YouTube: базовые домены + динамический CDN."""

    TIMEOUT = 10
    USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )

    # Базовые домены YouTube (не меняются)
    BASE_DOMAINS = [
        "youtube.com",
        "www.youtube.com",
        "youtu.be",
        "i.ytimg.com",
        "yt3.ggpht.com",
        "yt3.googleusercontent.com",
        "googleapis.com",
        "youtubei.googleapis.com",
        "manifest.googlevideo.com",
    ]

    # Видео, по которому собираются актуальные CDN-домены
    TEST_VIDEO_ID = "dQw4w9WgXcQ"
    WATCH_URL = f"https://www.youtube.com/watch?v={TEST_VIDEO_ID}"

    def __init__(self, config: dict):
        self._config = config
        self._headers = {"User-Agent": self.USER_AGENT}

    def _fetch_dynamic_domains(self) -> list[str]:
        """Собирает актуальные googlevideo.com домены со страницы видео."""
        session = requests.Session()
        session.headers.update(self._headers)

        try:
            response = session.get(
                self.WATCH_URL,
                timeout=self.TIMEOUT,
                allow_redirects=True,
                verify=True,
            )
            if response.status_code == 200:
                html = response.text
                # Ищем вид rr*---sn-*.googlevideo.com в HTML
                domains = set(re.findall(
                    r"(rr[0-9]+---sn-[a-z0-9-]+\.googlevideo\.com)",
                    html,
                ))
                return sorted(domains)
        except Exception:
            pass
        finally:
            session.close()

        return []

    def _check_domain(self, domain: str) -> tuple[bool, int | None, float | None]:
        """Проверяет один домен. Возвращает (доступен, http_code, время_мс)."""
        url = f"https://{domain}"
        start = time.perf_counter()
        session = requests.Session()
        session.headers.update(self._headers)

        try:
            response = session.get(
                url,
                timeout=self.TIMEOUT,
                allow_redirects=True,
                verify=True,
            )
            elapsed = (time.perf_counter() - start) * 1000
            response.close()
            # Любой HTTP-ответ = домен доступен
            return True, response.status_code, round(elapsed, 1)
        except Exception:
            elapsed = (time.perf_counter() - start) * 1000
            return False, None, round(elapsed, 1)
        finally:
            session.close()

    def test_youtube(
        self,
        progress_callback: Callable[[str, int, int], None] | None = None,
    ) -> YouTubeResult:
        """Тестирует YouTube: базовые домены + динамические CDN."""
        result = YouTubeResult()

        # 1. Динамические CDN-домены
        dynamic_domains = self._fetch_dynamic_domains()

        # 2. Полный список доменов
        all_domains = list(self.BASE_DOMAINS) + dynamic_domains
        total = len(all_domains)

        # 3. Результаты по доменам
        opened = []
        failed = []

        for i, domain in enumerate(all_domains):
            ok, code, ms = self._check_domain(domain)
            if ok:
                opened.append(domain)
            else:
                failed.append(domain)
            if progress_callback:
                progress_callback(domain, i + 1, total)

        result.total_domains = total
        result.opened_count = len(opened)
        result.failed_count = len(failed)
        result.opened_domains = opened
        result.failed_domains = failed

        if result.opened_count == total:
            result.status = Status.OK
        elif result.opened_count > 0:
            result.status = Status.PARTIAL
        else:
            result.status = Status.BLOCKED

        return result
