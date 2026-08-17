import { isEveningWindow } from '../rhythm/day.js';

export function isEveningBreathingWindow(date = new Date()) {
  return isEveningWindow(date);
}
