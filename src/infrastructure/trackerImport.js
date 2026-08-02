// Импорт CSV из выгрузок трекеров (Health Connect, Zepp, Huawei Health, Garmin…).
// Терпимый парсер: ищем знакомые колонки, непонятное пропускаем молча.
// Антихрупкость: любой мусор во входе не должен ломать журнал.

const COL = {
  date: /^(date|день|дата|day|start ?date|startTime|время начала)$/i,
  steps: /^(steps?|шаги|step ?count|количество шагов|total ?steps)$/i,
  sleep: /^(sleep|сон|sleep ?(duration|hours|time)|длительность сна|total ?sleep)/i,
  restingHr: /^(resting ?(heart ?rate|hr)|пульс покоя|rhr)$/i,
  hrv: /^(hrv|вариабельность|rmssd)/i,
};

function splitCsvLine(line, sep) {
  const out = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === sep && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim().replace(/^"|"$/g, ''));
}

function parseDate(raw) {
  const s = (raw || '').trim().slice(0, 19);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return null;
}

const num = (raw) => {
  const v = parseFloat(String(raw || '').replace(',', '.').replace(/[^\d.\-]/g, ''));
  return Number.isFinite(v) ? v : null;
};

export function parseTrackerCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const header = splitCsvLine(lines[0], sep);
  const idx = {};
  header.forEach((h, i) => {
    for (const [key, re] of Object.entries(COL)) {
      if (idx[key] === undefined && re.test(h)) idx[key] = i;
    }
  });
  if (idx.date === undefined) return [];

  const byDate = new Map();
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, sep);
    const date = parseDate(cells[idx.date]);
    if (!date) continue;
    const row = byDate.get(date) || { date };
    const steps = idx.steps !== undefined ? num(cells[idx.steps]) : null;
    if (steps !== null && steps >= 0 && steps < 200000) {
      row.steps = Math.max(row.steps || 0, Math.round(steps));
    }
    let sleep = idx.sleep !== undefined ? num(cells[idx.sleep]) : null;
    if (sleep !== null && sleep > 0) {
      if (sleep > 24) sleep /= 60; // похоже на минуты
      if (sleep > 0 && sleep <= 16) row.sleepHours = Math.round(sleep * 10) / 10;
    }
    const hr = idx.restingHr !== undefined ? num(cells[idx.restingHr]) : null;
    if (hr !== null && hr >= 30 && hr <= 130) row.restingHr = Math.round(hr);
    const hrv = idx.hrv !== undefined ? num(cells[idx.hrv]) : null;
    if (hrv !== null && hrv > 0 && hrv < 300) row.hrv = Math.round(hrv);
    byDate.set(date, row);
  }
  return [...byDate.values()]
    .filter((r) => r.steps || r.sleepHours || r.restingHr || r.hrv)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-90);
}
