import {
  STRUM_COOLDOWN_MS,
  STRUM_THRESHOLD,
} from "./config.js";

let prevY = null;
let lastStrum = 0;

export function resetStrum() {
  prevY = null;
  lastStrum = 0;
}

export function detectStrum(y) {
  if (prevY == null) {
    prevY = y;
    return null;
  }

  const dy = y - prevY;
  prevY = y;

  const now = Date.now();
  if (now - lastStrum < STRUM_COOLDOWN_MS) return null;

  if (dy > STRUM_THRESHOLD) {
    lastStrum = now;
    return "down";
  }

  if (dy < -STRUM_THRESHOLD) {
    lastStrum = now;
    return "up";
  }

  return null;
}
