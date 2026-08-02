import { pulseSignalSummary } from '../domain/practice/breathing.js';

const initialSnapshot = () => ({
  mode: 'none', streaming: false, ibis: [], hr: null, rmssd: null, quality: 0, error: '',
});

export function pulseErrorText(reason, mode) {
  if (reason === 'no-api') return 'Камера не поддерживается этим браузером.';
  if (reason === 'no-ble') return 'Web Bluetooth не поддерживается. Используйте Chrome, Opera или Edge.';
  if (reason === 'NotAllowedError') return mode === 'ble' ? 'Доступ к Bluetooth не разрешён.' : 'Доступ к камере не разрешён.';
  if (reason === 'NotFoundError') return mode === 'ble' ? 'Датчик не выбран или не найден.' : 'Камера не найдена.';
  return mode === 'ble'
    ? 'Не удалось подключить датчик. Включите на нём передачу пульса.'
    : 'Камера недоступна. Можно использовать отсчёт касанием.';
}

export function createPulseSensor(onChange = () => {}, navigatorRef = globalThis.navigator) {
  let state = initialSnapshot();
  let lastBeat = 0;
  let stream = null;
  let frame = 0;
  let device = null;
  let video = null;
  let canvas = null;
  let baseline = 0;
  let amplitude = 0;
  let previousAc = 0;
  let amplitudeOk = false;

  const emit = () => onChange({ ...state, ibis: [...state.ibis] });
  const summarize = () => {
    const summary = pulseSignalSummary(state.ibis, state.mode, amplitudeOk);
    state = { ...state, ...summary };
    emit();
  };
  const pushIbi = (time, interval) => {
    if (interval < 300 || interval > 1500) return;
    state = { ...state, ibis: [...state.ibis, { t: time, ibi: interval }].slice(-80) };
    summarize();
  };
  const pushBeat = (time = Date.now()) => {
    if (lastBeat) pushIbi(time, time - lastBeat);
    lastBeat = time;
  };

  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    stream?.getTracks?.().forEach((track) => track.stop());
    stream = null;
    try { if (device?.gatt?.connected) device.gatt.disconnect(); } catch { /* fail-soft */ }
    device = null;
    if (video) video.srcObject = null;
    video = null;
    canvas = null;
    lastBeat = 0;
    baseline = 0;
    amplitude = 0;
    previousAc = 0;
    amplitudeOk = false;
    state = initialSnapshot();
    emit();
  };

  const parseHeartRate = (data) => {
    try {
      const flags = data.getUint8(0);
      let offset = 1;
      const hr = flags & 1 ? data.getUint16(offset, true) : data.getUint8(offset);
      offset += flags & 1 ? 2 : 1;
      if (flags & 8) offset += 2;
      const now = Date.now();
      if (flags & 16) {
        const intervals = [];
        while (offset + 1 < data.byteLength) {
          intervals.push(data.getUint16(offset, true) * 1000 / 1024);
          offset += 2;
        }
        let time = now - intervals.reduce((sum, value) => sum + value, 0);
        intervals.forEach((interval) => { time += interval; pushIbi(time, interval); });
      } else if (hr > 30 && hr < 220) pushIbi(now, 60_000 / hr);
    } catch { /* повреждённый пакет игнорируется */ }
  };

  const attachBluetooth = async (selectedDevice) => {
    const server = await selectedDevice.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    const characteristic = await service.getCharacteristic('heart_rate_measurement');
    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged', (event) => parseHeartRate(event.target.value));
    selectedDevice.addEventListener('gattserverdisconnected', () => {
      if (state.mode !== 'ble') return;
      state = { ...state, streaming: false, error: 'Датчик отключился — переподключите его.' };
      emit();
    });
    device = selectedDevice;
    state = { ...initialSnapshot(), mode: 'ble', streaming: true };
    emit();
  };

  const sampleCamera = () => {
    if (!state.streaming || state.mode !== 'camera') return;
    try {
      if (video?.readyState >= 2) {
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(video, 0, 0, 48, 48);
        const pixels = context.getImageData(14, 14, 20, 20).data;
        let red = 0;
        for (let index = 0; index < pixels.length; index += 4) red += pixels[index];
        const value = red / Math.max(1, pixels.length / 4);
        baseline = baseline ? baseline + 0.05 * (value - baseline) : value;
        const ac = baseline - value;
        amplitude += 0.05 * (Math.abs(ac) - amplitude);
        amplitudeOk = amplitude > 1.2;
        const threshold = amplitude * 0.5;
        if (previousAc <= threshold && ac > threshold && amplitudeOk) pushBeat(Date.now());
        previousAc = ac;
      }
    } catch { /* один неудачный кадр не останавливает поток */ }
    frame = requestAnimationFrame(sampleCamera);
  };

  const start = async (mode, options = {}) => {
    stop();
    if (mode === 'tap') {
      state = { ...initialSnapshot(), mode: 'tap', streaming: true };
      emit();
      return { ok: true };
    }
    if (mode === 'ble') {
      if (!navigatorRef?.bluetooth) return { ok: false, reason: 'no-ble' };
      try {
        const selected = await navigatorRef.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
        await attachBluetooth(selected);
        return { ok: true };
      } catch (error) { return { ok: false, reason: error?.name || 'ble-error' }; }
    }
    if (mode === 'camera') {
      if (!navigatorRef?.mediaDevices?.getUserMedia || !options.video) return { ok: false, reason: 'no-api' };
      try {
        stream = await navigatorRef.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 320 }, height: { ideal: 240 } }, audio: false });
        video = options.video;
        video.srcObject = stream;
        await video.play().catch(() => {});
        const track = stream.getVideoTracks()[0];
        try {
          const capabilities = track.getCapabilities?.();
          if (capabilities?.torch) await track.applyConstraints({ advanced: [{ torch: true }] });
        } catch { /* вспышка необязательна */ }
        canvas = document.createElement('canvas');
        canvas.width = 48;
        canvas.height = 48;
        state = { ...initialSnapshot(), mode: 'camera', streaming: true };
        emit();
        sampleCamera();
        return { ok: true };
      } catch (error) { stop(); return { ok: false, reason: error?.name || 'camera-error' }; }
    }
    return { ok: false, reason: 'unknown' };
  };

  return {
    start,
    stop,
    tap: () => { if (state.mode === 'tap' && state.streaming) pushBeat(Date.now()); },
    snapshot: () => ({ ...state, ibis: [...state.ibis] }),
  };
}
