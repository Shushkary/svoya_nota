import React, { useEffect, useRef } from 'react';
import { advanceNutritionMotion, drawCenter, drawNutrition } from './toroidDraw.js';

export default function ToroidCanvas({ variant = 'nutrition', intensity = 0, expansion = .5, segments = [], label, sublabel, className = '' }) {
  const canvasRef = useRef(null);
  const values = useRef(null);
  values.current = { variant, intensity, expansion, segments, label, sublabel };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let width = 1; let height = 1; let pixelRatio = 1; let frame = 0; let resizeFrame = 0; let lastPaint = -Infinity;
    let nutritionMotion = null;
    let ink = '#24231F'; let muted = '#666255';
    const updateThemeColors = () => {
      const styles = getComputedStyle(document.documentElement);
      ink = styles.getPropertyValue('--ink').trim() || ink;
      muted = styles.getPropertyValue('--muted').trim() || muted;
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      pixelRatio = Math.min(window.devicePixelRatio || 1, width < 500 ? 1.6 : 2);
      const bitmapWidth = Math.round(width * pixelRatio);
      const bitmapHeight = Math.round(height * pixelRatio);
      if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
      if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };
    const scheduleResize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(resize);
    };
    const paint = (time) => {
      frame = requestAnimationFrame(paint);
      const interval = reduced ? 200 : 1000 / 30;
      if (document.hidden || time - lastPaint < interval) return;
      lastPaint = time;
      // Мобильные Chromium/WebView иногда сбрасывают transform backing-store
      // после переразметки длинной страницы. Восстанавливаем DPR каждый кадр.
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      const props = values.current;
      if (props.variant === 'center') drawCenter(context, width, height, props);
      else {
        nutritionMotion = advanceNutritionMotion(nutritionMotion, time, props.intensity, reduced);
        drawNutrition(context, width, height, time, {
          ...props,
          motionIntensity: nutritionMotion.intensity,
          pulsePhase: nutritionMotion.phase,
        }, reduced);
      }
      if (props.label) {
        context.textAlign = 'center'; context.fillStyle = ink; context.font = '18px Georgia, serif';
        context.fillText(props.label, width / 2, height / 2 + 5);
        if (props.sublabel) { context.fillStyle = muted; context.font = '10px system-ui, sans-serif'; context.fillText(props.sublabel, width / 2, height / 2 + 22); }
      }
    };
    updateThemeColors();
    resize();
    // Наблюдаем контейнер, а не сам canvas. Изменение canvas.width/height
    // меняет его intrinsic-размер; наблюдение за ним создаёт цикл resize →
    // новый bitmap → resize. На мобильных это проявлялось уменьшенным тороидом
    // в левом верхнем углу после добавления нескольких сегментов.
    const observed = canvas.parentElement || canvas;
    const observer = new ResizeObserver(scheduleResize); observer.observe(observed);
    window.addEventListener('orientationchange', scheduleResize);
    const themeObserver = new MutationObserver(updateThemeColors);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    frame = requestAnimationFrame(paint);
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(resizeFrame); observer.disconnect(); themeObserver.disconnect(); window.removeEventListener('orientationchange', scheduleResize); };
  }, [variant]);

  return <canvas ref={canvasRef} className={`torus-canvas ${className}`} role="img" aria-label={label || 'Тороид'} />;
}
