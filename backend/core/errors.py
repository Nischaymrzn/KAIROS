"""Consistent JSON error envelope + exception handlers.

Every error (validation, HTTP, or unexpected) returns the same shape:
    {"error": {"type": ..., "message": ..., "request_id": ...}}
"""
from __future__ import annotations
import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from backend.core.logging import get_request_id

log = logging.getLogger("hoopiq.api")


def _envelope(status: int, type_: str, message, request: Request) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"type": type_, "message": message,
                           "request_id": get_request_id()}},
    )


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def _http(request: Request, exc: HTTPException):
        return _envelope(exc.status_code, "http_error", exc.detail, request)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        return _envelope(422, "validation_error", exc.errors(), request)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        log.exception("unhandled: %s", exc)
        return _envelope(500, "internal_error",
                         "an unexpected error occurred", request)
