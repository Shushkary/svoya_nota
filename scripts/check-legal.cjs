const fs = require('node:fs');
const path = require('node:path');

const dist = path.resolve(__dirname, '..', 'dist');
const expected = {
  'pricing.html': ['Тарифы и услуги — Своя нота', '149 ₽', '299 ₽ / 30 дней', 'Без автосписаний'],
  'license.html': ['Лицензионное соглашение — Своя нота', 'Отказ от услуги', 'Некачественно оказанная услуга', '10 календарных дней'],
  'privacy.html': ['Политика обработки данных — Своя нота', 'ИП Таймаскин Александр Николаевич', 'AI Tunnel', 'Robokassa'],
};

for (const [name, needles] of Object.entries(expected)) {
  const file = path.join(dist, name);
  if (!fs.existsSync(file)) throw new Error(`Нет документа ${name} в dist`);
  const html = fs.readFileSync(file, 'utf8');
  for (const needle of needles) {
    if (!html.includes(needle)) throw new Error(`${name}: нет обязательного текста «${needle}»`);
  }
  if (html.includes('<div id="root"></div>')) throw new Error(`${name}: вместо документа собрана SPA-оболочка`);
}

if (!fs.existsSync(path.join(dist, 'legal.css'))) throw new Error('Нет legal.css в dist');
console.log('Legal pages check: pricing, license and privacy are real standalone documents.');
