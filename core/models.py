from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class Status(Enum):
    OK = "ДОСТУПЕН"
    BLOCKED = "ЗАБЛОКИРОВАН"
    TIMEOUT = "ТАЙМАУТ"
    ERROR = "ОШИБКА"
    PARTIAL = "ЧАСТИЧНО"


@dataclass
class SiteResult:
    name: str
    url: str
    status: Status
    http_code: int | None = None
    response_time_ms: float | None = None
    error_message: str | None = None
    timestamp: str = field(default_factory=lambda: datetime.now().strftime("%H:%M:%S"))

    @property
    def display_status(self) -> str:
        return self.status.value


@dataclass
class YouTubeResult:
    name: str = "YouTube"
    status: Status = Status.ERROR
    total_domains: int = 0
    opened_count: int = 0
    failed_count: int = 0
    opened_domains: list[str] = field(default_factory=list)
    failed_domains: list[str] = field(default_factory=list)
    error_message: str | None = None
    timestamp: str = field(default_factory=lambda: datetime.now().strftime("%H:%M:%S"))

    @property
    def display_status(self) -> str:
        return self.status.value


@dataclass
class BenchmarkSummary:
    total_sites: int = 0
    accessible: int = 0
    blocked: int = 0
    timeout: int = 0
    errors: int = 0
    total_time_ms: float = 0.0
    youtube: YouTubeResult | None = None
    site_results: list[SiteResult] = field(default_factory=list)
    timestamp: str = field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
