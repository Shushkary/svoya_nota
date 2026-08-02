"""FastAPI-маршруты. Эндпоинты синхронные: uvicorn выполняет их в threadpool,
БД — SQLite, внешний вызов один и ограничен таймаутом."""

from __future__ import annotations

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import JSONResponse

from nota.application.errors import AppError, AuthError
from nota.application.services import PhotoAnalysisResult, Services
from nota.domain.kbju import MealEstimate
from nota.presentation.schemas import (
    AiConsentIn,
    BarcodeLookupOut,
    DataConsentIn,
    EstimateOut,
    MealPhotoIn,
    MealTextIn,
    SyncIn,
)

MAX_API_BODY_BYTES = 1_500_000


def _estimate_out(
    estimate: MealEstimate,
    *,
    trial_remaining: int | None = None,
    trial_limit: int | None = None,
    idempotent_replay: bool = False,
) -> EstimateOut:
    return EstimateOut(
        description=estimate.description,
        kcal=estimate.kcal,
        proteinG=estimate.protein_g,
        fatG=estimate.fat_g,
        carbG=estimate.carb_g,
        fiberG=estimate.fiber_g,
        sodiumMg=estimate.sodium_mg,
        potassiumMg=estimate.potassium_mg,
        magnesiumMg=estimate.magnesium_mg,
        confidence=estimate.confidence,
        comment=estimate.comment,
        trialRemaining=trial_remaining,
        trialLimit=trial_limit,
        idempotentReplay=idempotent_replay,
    )


def build_app(services: Services, version: str, llm_provider: str) -> FastAPI:
    app = FastAPI(title="Своя нота · API", docs_url=None, redoc_url=None, openapi_url=None)
    router = APIRouter()

    @app.middleware("http")
    async def protect_api_responses(request: Request, call_next):
        """Keep personal API responses out of browser/proxy caches.

        Content-Length is only an early rejection; endpoint schemas keep their own
        strict limits when a client uses chunked transfer encoding.
        """
        if request.url.path.startswith("/api/"):
            try:
                content_length = int(request.headers.get("content-length", "0"))
            except ValueError:
                content_length = 0
            if content_length > MAX_API_BODY_BYTES:
                return JSONResponse(status_code=413, content={"error": "payload_too_large"})
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    def bearer_token(request: Request) -> str:
        header = request.headers.get("authorization", "")
        if not header.lower().startswith("bearer "):
            raise AuthError()
        token = header[7:].strip()
        if not token:
            raise AuthError()
        return token

    def auth(request: Request) -> int:
        return services.authenticate(bearer_token(request))

    @app.exception_handler(AppError)
    async def app_error_handler(_request: Request, exc: AppError):
        return JSONResponse(status_code=exc.http_status, content={"error": exc.code})

    @router.get("/health")
    def health():
        if not services.is_healthy():
            return JSONResponse(status_code=503, content={"ok": False, "version": version})
        return {"ok": True, "version": version, "llm_provider": llm_provider}

    @router.post("/api/register")
    def register(body: DataConsentIn, request: Request):
        # Не доверяем X-Forwarded-For без настроенного reverse proxy. Адрес нужен
        # только для краткого хэшированного rate-limit в памяти процесса.
        source = request.client.host if request.client else ""
        return {"token": services.register_device(source, body.granted, body.version)}

    @router.post("/api/sync")
    def sync(body: SyncIn, device_id: int = Depends(auth)):
        return services.sync(device_id, [entry.model_dump() for entry in body.entries])

    @router.get("/api/snapshot")
    def snapshot(device_id: int = Depends(auth)):
        return {"entries": services.snapshot(device_id)}

    @router.delete("/api/me")
    def delete_me(token: str = Depends(bearer_token)):
        services.delete_me_by_token(token)
        return {"deleted": True}

    @router.put("/api/consents/ai")
    def set_ai_consent(body: AiConsentIn, device_id: int = Depends(auth)):
        services.set_ai_consent(device_id, body.granted, body.version)
        return {"granted": body.granted, "version": body.version}

    @router.put("/api/consents/data")
    def set_data_consent(body: DataConsentIn, device_id: int = Depends(auth)):
        services.set_data_consent(device_id, body.granted, body.version)
        return {"granted": body.granted, "version": body.version}

    @router.post("/api/meals/estimate")
    def estimate(body: MealTextIn, device_id: int = Depends(auth)) -> EstimateOut:
        return _estimate_out(services.estimate_meal_text(device_id, body.description))

    @router.get("/api/meals/photo-trial")
    def photo_trial(device_id: int = Depends(auth)):
        return services.photo_trial_status(device_id)

    @router.get("/api/products/barcode/{code}", response_model=BarcodeLookupOut)
    def barcode(code: str, device_id: int = Depends(auth)) -> BarcodeLookupOut:
        product = services.lookup_barcode(device_id, code)
        if product is None:
            return BarcodeLookupOut(found=False, code=code)
        return BarcodeLookupOut(
            found=True,
            code=product.code,
            name=product.name,
            brand=product.brand or None,
            kcal100g=product.kcal_100g,
            protein100g=product.protein_100g,
            fat100g=product.fat_100g,
            carb100g=product.carb_100g,
            fiber100g=product.fiber_100g,
            sugars100g=product.sugars_100g,
            sodiumMg100g=product.sodium_mg_100g,
            novaGroup=product.nova_group,
            source=product.source,
            nutritionFound=product.nutrition_available,
        )

    @router.post("/api/meals/analyze")
    def analyze(
        body: MealPhotoIn, request: Request, device_id: int = Depends(auth)
    ) -> EstimateOut:
        result: PhotoAnalysisResult = services.analyze_meal_photo(
            device_id,
            body.image,
            body.hint,
            request.headers.get("idempotency-key"),
        )
        return _estimate_out(
            result.estimate,
            trial_remaining=result.trial_remaining,
            trial_limit=result.trial_limit,
            idempotent_replay=result.idempotent_replay,
        )

    app.include_router(router)

    from nota.presentation.admin_api import build_referral_routers

    admin_router, public_router = build_referral_routers(services.repo)
    app.include_router(admin_router)
    app.include_router(public_router)
    return app
