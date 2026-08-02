"""Прикладные ошибки: стабильные коды без деталей провайдера наружу."""

from __future__ import annotations


class AppError(Exception):
    code = "app_error"
    http_status = 400

    def __init__(self, message: str = ""):
        super().__init__(message or self.code)


class AuthError(AppError):
    code = "unauthorized"
    http_status = 401


class FeatureDisabledError(AppError):
    code = "feature_disabled"
    http_status = 403


class ConsentRequiredError(AppError):
    code = "consent_required"
    http_status = 403


class QuotaExceededError(AppError):
    code = "quota_exceeded"
    http_status = 429


class RateLimitedError(AppError):
    code = "rate_limited"
    http_status = 429


class RequestInProgressError(AppError):
    code = "request_in_progress"
    http_status = 409


class IdempotencyConflictError(AppError):
    code = "idempotency_conflict"
    http_status = 409


class BadRequestError(AppError):
    code = "bad_request"
    http_status = 422


class ProviderUnavailableError(AppError):
    code = "provider_unavailable"
    http_status = 502
