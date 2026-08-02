export function isEveningBreathingWindow(date = new Date()) {
  const hour = date.getHours();
  return hour >= 21 && hour < 23;
}
