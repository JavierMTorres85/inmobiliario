"""Small, defensive client for the official Idealista Search API.

The module is intentionally independent from the public dashboard. API secrets
must only be supplied to a local process or a protected CI environment.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import base64
import time
from typing import Any, Callable, Iterator, Mapping

import requests


class IdealistaAPIError(RuntimeError):
    """Raised when the Search API returns an invalid or unsuccessful response."""

    def __init__(self, message: str, *, status_code: int | None = None, payload: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


class IdealistaAuthenticationError(IdealistaAPIError):
    """Raised when an OAuth token cannot be obtained."""


@dataclass(frozen=True)
class SearchRequest:
    """Parameters for one Idealista Search API request."""

    country: str = "es"
    operation: str = "sale"
    property_type: str = "homes"
    location_id: str | None = None
    center: str | None = None
    distance: int | None = None
    locale: str | None = None
    max_items: int = 50
    num_page: int = 1
    max_price: int | None = None
    min_price: int | None = None
    since_date: str | None = None
    order: str | None = None
    sort: str | None = None
    custom_filters: Mapping[str, str | bool | int | float] = field(default_factory=dict)

    def to_payload(self) -> dict[str, str | bool | int | float]:
        if not self.location_id and not self.center:
            raise ValueError("A location_id or center is required")
        if self.center and self.distance is None:
            raise ValueError("distance is required when center is used")
        if self.max_items < 1 or self.max_items > 50:
            raise ValueError("max_items must be between 1 and 50")
        if self.num_page < 1:
            raise ValueError("num_page must be at least 1")

        values: dict[str, Any] = {
            "operation": self.operation,
            "propertyType": self.property_type,
            "locationId": self.location_id,
            "center": self.center,
            "distance": self.distance,
            "locale": self.locale,
            "maxItems": self.max_items,
            "numPage": self.num_page,
            "maxPrice": self.max_price,
            "minPrice": self.min_price,
            "sinceDate": self.since_date,
            "order": self.order,
            "sort": self.sort,
        }
        values.update(self.custom_filters)
        return {key: value for key, value in values.items() if value is not None}


@dataclass(frozen=True)
class SearchResponse:
    """The aggregate and optional listing data returned by one search page."""

    actual_page: int
    items_per_page: int
    total: int
    total_pages: int
    elements: tuple[dict[str, Any], ...]
    raw: Mapping[str, Any]

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "SearchResponse":
        elements = payload.get("elementList") or []
        return cls(
            actual_page=int(payload.get("actualPage") or 1),
            items_per_page=int(payload.get("itemsPerPage") or 0),
            total=int(payload.get("total") or 0),
            total_pages=int(payload.get("totalPages") or 0),
            elements=tuple(dict(item) for item in elements),
            raw=payload,
        )


class IdealistaClient:
    """OAuth client with token renewal, timeouts and bounded retries."""

    TOKEN_URL = "https://api.idealista.com/oauth/token"
    API_ROOT = "https://api.idealista.com/3.5"

    def __init__(
        self,
        api_key: str,
        api_secret: str,
        *,
        timeout: float = 20.0,
        max_retries: int = 3,
        backoff_seconds: float = 1.0,
        session: requests.Session | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not api_key or not api_secret:
            raise ValueError("api_key and api_secret are required")
        if max_retries < 0:
            raise ValueError("max_retries cannot be negative")
        self.api_key = api_key
        self.api_secret = api_secret
        self.timeout = timeout
        self.max_retries = max_retries
        self.backoff_seconds = backoff_seconds
        self.session = session or requests.Session()
        self._sleep = sleep
        self._clock = clock
        self._token: str | None = None
        self._token_expires_at = 0.0

    @staticmethod
    def _json(response: requests.Response, context: str) -> Mapping[str, Any]:
        try:
            payload = response.json()
        except ValueError as exc:
            raise IdealistaAPIError(
                f"{context} returned a non-JSON response",
                status_code=response.status_code,
            ) from exc
        if not isinstance(payload, Mapping):
            raise IdealistaAPIError(
                f"{context} returned an unexpected JSON value",
                status_code=response.status_code,
                payload=payload,
            )
        return payload

    def _get_token(self, *, force: bool = False) -> str:
        if not force and self._token and self._clock() < self._token_expires_at:
            return self._token

        encoded = base64.b64encode(
            f"{self.api_key}:{self.api_secret}".encode("ascii")
        ).decode("ascii")
        response = self.session.post(
            self.TOKEN_URL,
            data={"grant_type": "client_credentials", "scope": "read"},
            headers={
                "Authorization": f"Basic {encoded}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            timeout=self.timeout,
        )
        payload = self._json(response, "OAuth token endpoint")
        token = payload.get("access_token")
        if response.status_code >= 400 or not isinstance(token, str) or not token:
            description = payload.get("error_description") or payload.get("message")
            raise IdealistaAuthenticationError(
                f"Unable to obtain Idealista token: {description or response.status_code}",
                status_code=response.status_code,
                payload=payload,
            )

        expires_in = max(int(payload.get("expires_in") or 300), 1)
        self._token = token
        self._token_expires_at = self._clock() + max(expires_in - 60, 1)
        return token

    def _retry_delay(self, response: requests.Response, attempt: int) -> float:
        retry_after = response.headers.get("Retry-After")
        if retry_after:
            try:
                return max(float(retry_after), 0.0)
            except ValueError:
                pass
        return self.backoff_seconds * (2**attempt)

    def search(self, request: SearchRequest) -> SearchResponse:
        payload = request.to_payload()
        url = f"{self.API_ROOT}/{request.country}/search"
        token = self._get_token()

        for attempt in range(self.max_retries + 1):
            response = self.session.post(
                url,
                data=payload,
                headers={
                    "Authorization": f"Bearer {token}",
                    "User-Agent": "inmobiliario-data-pipeline/1.0",
                },
                timeout=self.timeout,
            )

            if response.status_code == 401 and attempt < self.max_retries:
                token = self._get_token(force=True)
                continue
            if (response.status_code == 429 or response.status_code >= 500) and attempt < self.max_retries:
                self._sleep(self._retry_delay(response, attempt))
                continue

            response_payload = self._json(response, "Search API")
            if response.status_code >= 400:
                description = response_payload.get("error_description") or response_payload.get("message")
                raise IdealistaAPIError(
                    f"Idealista search failed: {description or response.status_code}",
                    status_code=response.status_code,
                    payload=response_payload,
                )
            return SearchResponse.from_payload(response_payload)

        raise IdealistaAPIError("Idealista search exhausted its retry budget")

    def iter_pages(self, request: SearchRequest, *, max_pages: int | None = None) -> Iterator[SearchResponse]:
        page = request.num_page
        yielded = 0
        while True:
            current = SearchRequest(**{**request.__dict__, "num_page": page})
            response = self.search(current)
            yield response
            yielded += 1
            if page >= response.total_pages or (max_pages is not None and yielded >= max_pages):
                return
            page += 1

