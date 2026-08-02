const readDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('image_read_failed'));
  reader.onload = () => resolve(reader.result);
  reader.readAsDataURL(blob);
});

const toBlob = (canvas, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('image_encode_failed')), 'image/jpeg', quality);
});

// Фото уменьшается только в памяти браузера и нигде не сохраняется.
export async function prepareMealImage(file, maxBytes = 850_000) {
  const accepted = ['image/jpeg', 'image/png', 'image/webp'];
  if (file.size <= maxBytes && accepted.includes(file.type)) return readDataUrl(file);
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  let scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  let result = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    canvas.width = Math.max(320, Math.round(bitmap.width * scale));
    canvas.height = Math.max(320, Math.round(bitmap.height * scale));
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    result = await toBlob(canvas, Math.max(0.5, 0.86 - attempt * 0.09));
    if (result.size <= maxBytes) break;
    scale *= 0.8;
  }
  bitmap.close?.();
  if (!result || result.size > maxBytes) throw new Error('image_too_large');
  return readDataUrl(result);
}
