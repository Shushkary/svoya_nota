// Ленивая загрузка офлайн-таблицы продуктов (Ciqual, CoFID, AFCD, USDA SR28).
// Это отдельный чанк сборки: динамический import() не блокирует первую
// отрисовку приложения тяжёлым файлом, а после первой загрузки сохраняется
// service worker'ом как обычный статический ассет — дальше таблица доступна
// без сети, как и раньше.
let cached = null;

export function loadFoodCatalog() {
  if (!cached) {
    cached = import('../data/foods-core.json').then((module) => {
      const bundle = module.default;
      return Array.isArray(bundle) ? bundle : bundle.foods || [];
    });
  }
  return cached;
}
