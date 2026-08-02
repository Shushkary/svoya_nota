"""HTTP DTO. Тонкие типы: содержательная валидация — в домене и use cases."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SyncEntryIn(BaseModel):
    kind: str = Field(max_length=32)
    clientId: str = Field(max_length=64)
    at: str = Field(max_length=40)
    updatedAt: str = Field(default="", max_length=40)
    payload: str = Field(max_length=20_000)


class SyncIn(BaseModel):
    entries: list[SyncEntryIn] = Field(max_length=250)


class DataConsentIn(BaseModel):
    granted: bool
    version: str = Field(min_length=1, max_length=64)


class MealTextIn(BaseModel):
    description: str = Field(max_length=600)


class AiConsentIn(BaseModel):
    granted: bool
    version: str = Field(min_length=1, max_length=64)


class MealPhotoIn(BaseModel):
    image: str = Field(max_length=1_400_000)  # data URL, base64 ≈ 1.33 × байт
    hint: str = Field(default="", max_length=250)


class AdminLoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=200)


class ReferralCreateIn(BaseModel):
    label: str = Field(default="", max_length=120)
    target_url: str = Field(default="", max_length=500)
    discount_percent: float = Field(default=0.0, ge=0, le=100)
    reward_percent: float = Field(default=0.0, ge=0, le=100)
    owner_contact: str = Field(default="", max_length=500)
    payment_details: str = Field(default="", max_length=1000)


class ReferralUpdateIn(BaseModel):
    label: str | None = Field(default=None, max_length=120)
    target_url: str | None = Field(default=None, max_length=500)
    discount_percent: float | None = Field(default=None, ge=0, le=100)
    reward_percent: float | None = Field(default=None, ge=0, le=100)
    owner_contact: str | None = Field(default=None, max_length=500)
    payment_details: str | None = Field(default=None, max_length=1000)
    active: int | None = Field(default=None, ge=0, le=1)


class EstimateOut(BaseModel):
    description: str
    kcal: int
    proteinG: float
    fatG: float
    carbG: float
    fiberG: float = 0.0
    sodiumMg: float = 0.0
    potassiumMg: float = 0.0
    magnesiumMg: float = 0.0
    confidence: float
    comment: str
    # Заполняются только для фото: это не часть оценки КБЖУ, а состояние
    # пробного доступа, чтобы клиент честно показывал пользователю остаток.
    trialRemaining: int | None = Field(default=None, ge=0)
    trialLimit: int | None = Field(default=None, ge=1)
    idempotentReplay: bool = False


class BarcodeLookupOut(BaseModel):
    found: bool
    code: str
    name: str | None = None
    brand: str | None = None
    kcal100g: float | None = None
    protein100g: float | None = None
    fat100g: float | None = None
    carb100g: float | None = None
    fiber100g: float | None = None
    sugars100g: float | None = None
    sodiumMg100g: float | None = None
    novaGroup: int | None = None
    source: str | None = None
    nutritionFound: bool = False
