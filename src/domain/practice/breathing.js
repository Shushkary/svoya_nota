const clamp = (value, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
};

const phase = (label, sec, kind, from, to) => ({ label, sec, kind, from, to });

const BUILDERS = Object.freeze({
  coherent: (cadence = 5.5) => {
    const half = 30 / clamp(cadence, 4.5, 6.5);
    return [phase('Вдох', half, 'in', 0, 1), phase('Выдох', half, 'out', 1, 0)];
  },
  box: () => [
    phase('Вдох', 4, 'in', 0, 1), phase('Задержка', 4, 'hold', 1, 1),
    phase('Выдох', 4, 'out', 1, 0), phase('Задержка', 4, 'hold', 0, 0),
  ],
  sigh: () => [
    phase('Вдох', 2, 'in', 0, 0.72), phase('Довдох', 1, 'in', 0.72, 1),
    phase('Долгий выдох', 6, 'out', 1, 0),
  ],
  r478: () => [
    phase('Вдох', 4, 'in', 0, 1), phase('Задержка', 7, 'hold', 1, 1),
    phase('Выдох', 8, 'out', 1, 0),
  ],
  belly: () => [phase('Вдох животом', 4, 'in', 0, 1), phase('Мягкий выдох', 6, 'out', 1, 0)],
  fire: () => [phase('Вдох', 1.2, 'in', 0, 1), phase('Активный выдох', 1.2, 'out', 1, 0)],
});

export function phasesFor(protocol, cadence = 5.5) {
  const builder = BUILDERS[protocol] || BUILDERS.coherent;
  try {
    return builder(cadence).map((item) => ({ ...item }));
  } catch {
    return BUILDERS.coherent(5.5);
  }
}

export function easeBreath(progress) {
  return 0.5 - 0.5 * Math.cos(Math.PI * clamp(progress, 0, 1));
}

export function cycleSeconds(phases) {
  return (phases || []).reduce((sum, item) => sum + Math.max(0, Number(item.sec) || 0), 0);
}

export function paceBpm(phases) {
  const seconds = cycleSeconds(phases);
  return seconds > 0 ? 60 / seconds : 0;
}

export function phaseAt(phases, elapsedSeconds) {
  const source = phases || [];
  const cycle = cycleSeconds(source);
  if (!source.length || cycle <= 0) {
    return { idx: 0, label: '', kind: 'hold', progress: 0, exp: 0, cyc: 0, tLeft: 0 };
  }
  let cursor = ((Number(elapsedSeconds) || 0) % cycle + cycle) % cycle;
  let index = 0;
  while (index < source.length && cursor >= source[index].sec) {
    cursor -= source[index].sec;
    index += 1;
  }
  if (index >= source.length) index = source.length - 1;
  const current = source[index];
  const progress = current.sec > 0 ? cursor / current.sec : 1;
  const expansion = current.from + (current.to - current.from) * easeBreath(progress);
  return {
    idx: index,
    label: current.label,
    kind: current.kind,
    progress,
    exp: clamp(expansion, 0, 1),
    cyc: cycle,
    tLeft: Math.ceil(current.sec - cursor),
  };
}

export function breathCount(phases, elapsedSeconds) {
  const seconds = cycleSeconds(phases);
  return seconds > 0 ? Math.floor(Math.max(0, Number(elapsedSeconds) || 0) / seconds) : 0;
}

export function adherence(taps, targetCycleSeconds) {
  if (!Array.isArray(taps) || taps.length < 3 || targetCycleSeconds <= 0) return null;
  const intervals = taps.slice(1).map((tap, index) => (tap - taps[index]) / 1000);
  const error = intervals.reduce(
    (sum, interval) => sum + Math.abs(interval - targetCycleSeconds),
    0,
  ) / intervals.length;
  return clamp(1 - error / targetCycleSeconds, 0, 1);
}

export function rmssd(ibis) {
  if (!Array.isArray(ibis) || ibis.length < 3) return null;
  let squared = 0;
  for (let index = 1; index < ibis.length; index += 1) {
    const difference = Number(ibis[index].ibi) - Number(ibis[index - 1].ibi);
    if (!Number.isFinite(difference)) return null;
    squared += difference * difference;
  }
  return Math.sqrt(squared / (ibis.length - 1));
}

const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor((sorted.length - 1) / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle] + sorted[middle + 1]) / 2;
};
const deviation = (values) => {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};
const pearson = (left, right) => {
  const length = Math.min(left.length, right.length);
  if (length < 3) return 0;
  const x = left.slice(0, length);
  const y = right.slice(0, length);
  const mx = mean(x);
  const my = mean(y);
  let product = 0;
  let xx = 0;
  let yy = 0;
  for (let index = 0; index < length; index += 1) {
    const dx = x[index] - mx;
    const dy = y[index] - my;
    product += dx * dy;
    xx += dx * dx;
    yy += dy * dy;
  }
  const denominator = Math.sqrt(xx * yy);
  return denominator > 0 ? product / denominator : 0;
};

export function pulseSignalSummary(ibis, mode = 'ble', amplitudeOk = true) {
  const recent = (ibis || []).slice(-8).map((item) => Number(item.ibi)).filter((value) => value >= 300 && value <= 1500);
  if (recent.length < 3) return { hr: null, quality: 0, rmssd: null };
  const hr = 60_000 / median(recent);
  const variation = deviation(recent) / (mean(recent) || 1);
  let quality = clamp(1 - variation * (mode === 'ble' ? 2 : 3), 0, 1);
  if (mode === 'camera' && !amplitudeOk) quality = Math.min(quality, 0.2);
  if (mode === 'tap') quality = Math.min(quality, 0.85);
  return { hr, quality, rmssd: rmssd(recent.map((ibi) => ({ ibi }))) };
}

// Оценка дыхательно-сердечного созвучия, не медицинский показатель.
export function breathingCoherence(ibis, expansionAt, startWall, accumulatedMs = 0, now = Date.now()) {
  const cutoff = now - 30_000;
  const segment = (ibis || []).filter((beat) => beat.t >= startWall && beat.t >= cutoff);
  if (segment.length < 6) return null;
  const rates = [];
  const expansionDelta = [];
  const inhaleRates = [];
  const exhaleRates = [];
  for (let index = 1; index < segment.length; index += 1) {
    const beat = segment[index];
    const previous = segment[index - 1];
    const rate = 60_000 / beat.ibi;
    const second = (accumulatedMs + beat.t - startWall) / 1000;
    const previousSecond = (accumulatedMs + previous.t - startWall) / 1000;
    const delta = expansionAt(second) - expansionAt(previousSecond);
    rates.push(rate);
    expansionDelta.push(delta);
    if (delta > 0) inhaleRates.push(rate);
    if (delta < 0) exhaleRates.push(rate);
  }
  const correlation = pearson(rates, expansionDelta);
  const averageRate = mean(rates);
  const rsa = inhaleRates.length && exhaleRates.length && averageRate > 0
    ? (mean(inhaleRates) - mean(exhaleRates)) / averageRate : 0;
  return clamp(0.5 * Math.max(correlation, 0) + 0.5 * clamp(rsa * 8, 0, 1), 0, 1);
}
