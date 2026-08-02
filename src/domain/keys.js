// Имена localStorage-ключей — единственный источник истины.
// Имена ключей локального хранилища — единый источник истины.
export const JOURNAL_KEY = 'nota.journal.v1';
export const NUTRITION_FORECAST_KEY = 'nota.nutrition.forecast.v1';
// Изолированный device-only контур «Самонаблюдение тела» (не в журнале, не в outbox).
export const BODY_KEY = 'nota.body.v1';
// Отметки веса — тоже device-only, но стираются вместе с остальными данными:
// пользователь должен иметь возможность удалить их из интерфейса.
export const WEIGHT_KEY = 'nota.weight.v1';
// Шаги, полученные с телефона: device-only, отдельно от синхронизируемого журнала.
export const PHONE_STEPS_KEY = 'nota.phone-steps.v1';
// Дневник питания встроенного виджета. Значение продублировано в
// src/nutrition/widget.html (отдельный документ в iframe, импорт модулей туда
// не доходит) — менять только вместе.
export const NUTRITION_WIDGET_KEY = 'nota.nutrition.v1';
// Настройки самочувствия и скрытая карточка Торион — устройство, не журнал.
export const PREFS_KEY = 'nota.prefs.v1';
export const TORION_HIDDEN_KEY = 'nota.torion.v1';
// Метка источника перехода (реферал) — техническая, без личных данных.
export const REFERRAL_KEY = 'nota_ref';
// Ключи прежнего виджета тороида, оставшиеся у ранних пользователей.
// Нужны только для того, чтобы «Удалить все данные» вычистило и их.
export const LEGACY_KEYS = Object.freeze(['t_history', 't_bio', 't_theme']);
