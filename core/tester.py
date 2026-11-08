import time
import requests
import threading
from typing import Callable

from .models import SiteResult, Status


class SiteTester:
    """Тестирует доступность сайтов."""

    TIMEOUT = 10
    USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )

    def __init__(self):
        self._headers = {"User-Agent": self.USER_AGENT}

    def test_site(self, name: str, url: str) -> SiteResult:
        """Тестирует один сайт. Возвращает SiteResult."""
        result = SiteResult(name=name, url=url, status=Status.ERROR)
        start = time.perf_counter()

        # Локальная сессия — потокобезопасно
        session = requests.Session()
        session.headers.update(self._headers)

        try:
            response = session.get(
                url,
                timeout=self.TIMEOUT,
                allow_redirects=True,
                verify=True,
            )
            elapsed_ms = (time.perf_counter() - start) * 1000

            result.http_code = response.status_code
            result.response_time_ms = round(elapsed_ms, 1)

            if response.status_code == 200:
                result.status = Status.OK
            elif 200 <= response.status_code <= 299:
                # 2xx (кроме 200): 201, 204 и т.п. — считаем доступным
                result.status = Status.OK
                result.error_message = f"HTTP {response.status_code}"
            elif response.status_code in (301, 302, 307, 308):
                result.status = Status.PARTIAL
                result.error_message = f"Redirect {response.status_code}"
            elif 400 <= response.status_code <= 599:
                # Сайт отвечает, но с ошибкой (WAF, баннер по региону, заглушка провайдера)
                result.status = Status.PARTIAL
                result.error_message = f"HTTP {response.status_code} (site responds)"
            else:
                result.status = Status.BLOCKED
                result.error_message = f"HTTP {response.status_code}"

        except requests.exceptions.ConnectionError:
            result.response_time_ms = round((time.perf_counter() - start) * 1000, 1)
            result.status = Status.BLOCKED
            result.error_message = "Соединение заблокировано (ConnectionError)"

        except requests.exceptions.Timeout:
            result.response_time_ms = round((time.perf_counter() - start) * 1000, 1)
            result.status = Status.TIMEOUT
            result.error_message = f"Таймаут {self.TIMEOUT}с"

        except requests.exceptions.SSLError:
            result.response_time_ms = round((time.perf_counter() - start) * 1000, 1)
            result.status = Status.BLOCKED
            result.error_message = "SSL-ошибка (возможен DPI)"

        except Exception as e:
            result.response_time_ms = round((time.perf_counter() - start) * 1000, 1)
            result.status = Status.ERROR
            result.error_message = str(e)[:100]

        finally:
            session.close()

        return result

    def test_sites_parallel(
        self,
        sites: list[tuple[str, str]],
        callback: Callable[[SiteResult], None] | None = None,
        max_workers: int = 10,
    ) -> list[SiteResult]:
        """Тестирует список сайтов параллельно в потоках."""
        results: dict[str, SiteResult] = {}
        results_lock = threading.Lock()
        semaphore = threading.Semaphore(max_workers)

        def worker(name: str, url: str):
            with semaphore:
                result = self.test_site(name, url)
                with results_lock:
                    results[url] = result
                if callback:
                    callback(result)

        threads = []
        for name, url in sites:
            t = threading.Thread(target=worker, args=(name, url), daemon=True)
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        return [results[url] for _, url in sites if url in results]
