"""Structured logging + a per-request id propagated via a contextvar.

`RequestContextMiddleware` stamps each request with an id, logs method/path/
status/latency, and sets the `X-Request-ID` response header. The id is available
anywhere via `get_request_id()`.
"""
from __future__ import annotations
import logging
import time
import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

_request_id: ContextVar[str] = ContextVar("request_id", default="-")


def get_request_id() -> str:
    return _request_id.get()


class _RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = _request_id.get()
        return True


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)-7s [%(request_id)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S"))
    handler.addFilter(_RequestIdFilter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:8]
        token = _request_id.set(rid)
        log = logging.getLogger("hoopiq.api")
        t0 = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            log.exception("unhandled error on %s %s", request.method, request.url.path)
            raise
        finally:
            _request_id.reset(token)
        ms = (time.perf_counter() - t0) * 1000
        response.headers["X-Request-ID"] = rid
        log.info("%s %s -> %s (%.0fms)", request.method, request.url.path,
                 response.status_code, ms)
        return response
