// MediaPipe Hands (JS) + plain DOM.
// Key parts:
// - Camera setup via getUserMedia
// - Hand detection via MediaPipe Tasks Vision
// - Simple gesture logic (no ML training): fist / two-fingers / open-hand
// - Map gesture -> chord (C, G, Am) and play audio on button press

import {
  FilesetResolver,
  HandLandmarker,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const statusEl = document.getElementById("status");
const chordEl = document.getElementById("chord");
const playBtn = document.getElementById("playBtn");
const debugLogEl = document.getElementById("debugLog");

const ctx = canvas.getContext("2d");

// --- In-app debug log (useful on mobile where DevTools isn't available) ---
const debugLines = [];
const STATUS_LOG_INTERVAL_MS = 30_000;
let lastStatusLogAt = 0;
function debugLog(line) {
  const ts = new Date().toLocaleTimeString();
  debugLines.unshift(`[${ts}] ${line}`);
  if (debugLines.length > 30) debugLines.length = 30;
  if (debugLogEl) debugLogEl.textContent = debugLines.join("\n");
}

function debugLogThrottled(line, intervalMs = STATUS_LOG_INTERVAL_MS) {
  const now = Date.now();
  if (now - lastStatusLogAt < intervalMs) return;
  lastStatusLogAt = now;
  debugLog(line);
}

// --- Web Audio chord synthesis (no external mp3 files) ---
// Mobile browsers (iOS Safari / Android Chrome) require AudioContext
// to be created or resumed only after a user interaction (button click).
/** @type {AudioContext | null} */
let audioCtx = null;
/** @type {GainNode | null} */
let masterGain = null;

const CHORD_FREQUENCIES = {
  C: [261.63, 329.63, 392.0], // C4, E4, G4
  G: [196.0, 246.94, 293.66], // G3, B3, D4
  Am: [220.0, 261.63, 329.63], // A3, C4, E4
};

function getOrCreateAudioContext() {
  if (!audioCtx) {
    // Safari uses webkitAudioContext.
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();

  // A small output chain to make it more audible across devices:
  // Oscillators -> masterGain -> compressor -> destination
  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-24, audioCtx.currentTime);
  compressor.knee.setValueAtTime(30, audioCtx.currentTime);
  compressor.ratio.setValueAtTime(12, audioCtx.currentTime);
  compressor.attack.setValueAtTime(0.003, audioCtx.currentTime);
  compressor.release.setValueAtTime(0.25, audioCtx.currentTime);

  masterGain = audioCtx.createGain();
  masterGain.gain.setValueAtTime(0.9, audioCtx.currentTime);
  masterGain.connect(compressor);
  compressor.connect(audioCtx.destination);

    debugLog("AUDIO: AudioContext created");
  }
  return audioCtx;
}

async function ensureAudioIsRunning() {
  const ac = getOrCreateAudioContext();
  debugLog(`AUDIO: state=${ac.state} mutedHint=${typeof navigator !== "undefined" ? "n/a" : "n/a"}`);
  if (ac.state === "suspended") {
    // Must be called as a direct result of a user gesture.
    await ac.resume();
    debugLog("AUDIO: AudioContext resumed");
  }
}

function playNote(ac, frequency, startTime, duration = 1.0) {
  // Oscillator = tone source. GainNode = volume envelope.
  const osc = ac.createOscillator();
  const gain = ac.createGain();

  // Triangle sounds slightly more guitar-like than sine, but either is OK.
  osc.type = "triangle";
  osc.frequency.setValueAtTime(frequency, startTime);

  // Simple pluck-like envelope:
  // - quick attack (0.01s)
  // - smooth decay
  const attack = 0.01;
  // Bump peak a bit; masterGain + compressor will keep it from clipping.
  const peak = 0.35;
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(peak, startTime + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(gain);
  gain.connect(masterGain ?? ac.destination);

  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

// Reusable function required by prompt.
// Plays a triad (3 notes) with a tiny strum (slight delay between notes).
async function playChord(chordName) {
  const freqs = CHORD_FREQUENCIES[chordName];
  if (!freqs) return;

  await ensureAudioIsRunning();
  const ac = getOrCreateAudioContext();

  const now = ac.currentTime;
  const strumDelay = 0.02; // 20ms between strings
  // Default is down-strum order.
  freqs.forEach((f, i) => playNote(ac, f, now + i * strumDelay, 1.0));
}

// Direction-aware strum (down plays low->high, up reverses).
async function playChordStrum(chordName, direction = "down", velocity = 1) {
  const freqs = CHORD_FREQUENCIES[chordName];
  if (!freqs) return;

  await ensureAudioIsRunning();
  const ac = getOrCreateAudioContext();

  // Map velocity to overall volume (simple + capped).
  const v = Math.max(0.3, Math.min(1.2, velocity));
  if (masterGain) {
    masterGain.gain.setValueAtTime(0.85 * v, ac.currentTime);
  }

  const ordered = direction === "down" ? freqs : [...freqs].reverse();
  const now = ac.currentTime;
  const strumDelay = 0.02;
  ordered.forEach((f, i) => playNote(ac, f, now + i * strumDelay, 1.0));
}

// Quick audible sanity check tone. Useful when chord is "playing" but you hear nothing.
let hasPlayedTestBeep = false;
async function playTestBeep() {
  await ensureAudioIsRunning();
  const ac = getOrCreateAudioContext();
  const t = ac.currentTime;
  playNote(ac, 880, t, 0.15);
}

function attachGlobalErrorDiagnostics() {
  window.addEventListener("error", (e) => {
    debugLog(`WINDOW ERROR: ${e.message}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    debugLog(`PROMISE REJECTION: ${String(e.reason)}`);
  });
}

/** @type {HandLandmarker | null} */
let handLandmarker = null;
let running = false;
let lastVideoTime = -1;

let currentChord = null; // "C" | "G" | "Am" | null
let currentStatus = "Loading…";

// --- Right-hand strum detection (movement-based) ---
let prevY = null;
let lastStrumTime = 0;
let lastStrumDirection = null; // "up" | "down" | null
let lastStrumVelocity = 1;

function detectStrum(currentY) {
  if (prevY === null) {
    prevY = currentY;
    return null;
  }

  const deltaY = currentY - prevY;
  prevY = currentY;

  const now = Date.now();
  // prevent spamming
  if (now - lastStrumTime < 150) return null;

  // threshold for movement (tuneable)
  const THRESHOLD = 0.03;
  if (deltaY > THRESHOLD) {
    lastStrumTime = now;
    lastStrumVelocity = Math.min(1.2, 0.6 + Math.abs(deltaY) * 8);
    return "down";
  }
  if (deltaY < -THRESHOLD) {
    lastStrumTime = now;
    lastStrumVelocity = Math.min(1.2, 0.6 + Math.abs(deltaY) * 8);
    return "up";
  }
  return null;
}

function setStatus(text, { bad = false } = {}) {
  currentStatus = text;
  statusEl.textContent = text;
  statusEl.classList.toggle("bad", bad);
  // Hand detection updates can fire many times per second; keep the debug panel readable.
  // We still update the UI immediately, but only log to the debug panel every ~30s.
  debugLogThrottled(`STATUS: ${text}`);
}

function setChord(chord) {
  currentChord = chord;
  chordEl.textContent = chord ?? "—";
  playBtn.disabled = !chord;
}

// --- Gesture classification (simple heuristics) ---
// We count how many fingers appear "extended" using landmark geometry.
// Landmarks are normalized to [0..1] in image space.
// Indices: https://developers.google.com/mediapipe/solutions/vision/hand_landmarker
// Tips (for a simple minimal heuristic):
// - For index/middle/ring/pinky: if tip.y < pip.y => extended (hand upright)
// - For thumb: compare tip.x vs ip.x depending on handedness

function isFingerExtended(lm, tip, pip) {
  return lm[tip].y < lm[pip].y;
}

function isThumbExtended(lm, handednessLabel) {
  // Right hand: thumb tip tends to the left of IP when extended (mirroring can confuse,
  // but handedness is predicted before any CSS transform).
  // Left hand: opposite.
  const tipX = lm[4].x;
  const ipX = lm[3].x;
  if (handednessLabel === "Right") return tipX < ipX;
  if (handednessLabel === "Left") return tipX > ipX;
  // Fallback if unknown.
  return Math.abs(tipX - ipX) > 0.02;
}

function countExtendedFingers(lm, handednessLabel) {
  let count = 0;

  // Index
  if (isFingerExtended(lm, 8, 6)) count++;
  // Middle
  if (isFingerExtended(lm, 12, 10)) count++;
  // Ring
  if (isFingerExtended(lm, 16, 14)) count++;
  // Pinky
  if (isFingerExtended(lm, 20, 18)) count++;
  // Thumb
  if (isThumbExtended(lm, handednessLabel)) count++;

  return count;
}

function classifyGestureToChord(lm, handednessLabel) {
  const extended = countExtendedFingers(lm, handednessLabel);

  // Minimal mapping required by prompt:
  // - Fist -> C
  // - Two fingers -> G
  // - Open hand -> Am
  if (extended <= 1) return { chord: "C", label: `Fist-ish (${extended} finger)` };
  if (extended === 2) return { chord: "G", label: "Two fingers" };
  if (extended >= 4) return { chord: "Am", label: `Open hand (${extended} fingers)` };

  // 3 fingers (ambiguous) -> no chord
  return { chord: null, label: `Unclear (${extended} fingers)` };
}

// --- Camera setup ---
async function setupCamera() {
  // Simple getUserMedia with front camera preference.
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });

  video.srcObject = stream;

  await new Promise((resolve) => {
    video.onloadedmetadata = () => resolve();
  });

  await video.play();
}

function resizeCanvasToVideo() {
  // Keep canvas resolution in sync with actual video pixels.
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
}

// --- Hand detection loop ---
async function initHandLandmarker() {
  // Tasks Vision uses a WASM backend. FilesetResolver helps load the WASM assets.
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      // Lightweight model hosted by Google.
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
  numHands: 2,
  });
}

function drawLandmarks(lm) {
  const drawingUtils = new DrawingUtils(ctx);
  drawingUtils.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, {
    color: "rgba(122, 162, 255, 0.9)",
    lineWidth: 3,
  });
  drawingUtils.drawLandmarks(lm, {
    radius: 4,
    color: "rgba(233, 238, 252, 0.95)",
  });
}

function drawHandLabel(lm, text) {
  if (!lm?.[0]) return;
  const x = lm[0].x * canvas.width;
  const y = lm[0].y * canvas.height;

  ctx.save();
  ctx.font = "bold 16px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x - 4, y - 22, ctx.measureText(text).width + 10, 22);
  ctx.fillStyle = "rgba(233, 238, 252, 0.98)";
  ctx.fillText(text, x + 2, y - 6);
  ctx.restore();
}

function shouldTrustHandedness(handedness, score) {
  return (handedness === "Left" || handedness === "Right") && typeof score === "number" && score >= 0.6;
}

function assignHands(hands) {
  // Always sort by x for stable spatial assignment.
  const sorted = [...hands].sort((a, b) => a.centerX - b.centerX);
  const leftMost = sorted[0];
  const rightMost = sorted[sorted.length - 1];

  // If we have two hands and handedness is trustworthy and not conflicting, we can use it.
  if (sorted.length >= 2) {
    const h0 = sorted[0];
    const h1 = sorted[1];
    const trust0 = shouldTrustHandedness(h0.handedness, h0.score);
    const trust1 = shouldTrustHandedness(h1.handedness, h1.score);
    const bothTrust = trust0 && trust1;
    const different = h0.handedness !== h1.handedness;
    if (bothTrust && different) {
      const chordHand = sorted.find((h) => h.handedness === "Left") ?? leftMost;
      const strumHand = sorted.find((h) => h.handedness === "Right") ?? rightMost;
      return { chordHand, strumHand, sorted, reason: "handedness" };
    }
  }

  // Fallback: spatial assignment.
  return { chordHand: leftMost, strumHand: rightMost, sorted, reason: "spatial" };
}

async function tick() {
  if (!running) return;
  if (!handLandmarker) return;

  resizeCanvasToVideo();

  // Avoid redundant processing.
  if (video.currentTime === lastVideoTime) {
    requestAnimationFrame(tick);
    return;
  }
  lastVideoTime = video.currentTime;

  const nowMs = performance.now();

  const result = handLandmarker.detectForVideo(video, nowMs);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!result.landmarks || result.landmarks.length === 0) {
    setStatus("No hand detected", { bad: false });
    setChord(null);
  // Reset strum tracking only when strum hand disappears.
  prevY = null;
    requestAnimationFrame(tick);
    return;
  }

  // Process up to 2 hands each frame.
  // LEFT hand selects chord; RIGHT hand strums (index finger tip movement).
  /** @type {{lm: any, handedness: string, score?: number, centerX: number, index: number}[]} */
  const hands = result.landmarks.map((lm, i) => {
    const handedness = result.handednesses?.[i]?.[0]?.categoryName ?? "";
    const score = result.handednesses?.[i]?.[0]?.score;
    // Use wrist (0) x as a rough screen-side fallback.
    const centerX = lm?.[0]?.x ?? 0.5;
    return { lm, handedness, score, centerX, index: i };
  });

  // Strong multi-hand debug.
  debugLogThrottled(`HANDS: ${hands.length}`, 1000);
  for (const h of hands) {
    const hs = h.handedness || "?";
    const sc = typeof h.score === "number" ? h.score.toFixed(2) : "?";
    debugLogThrottled(`HAND[${h.index}]: ${hs} (${sc}) x=${h.centerX.toFixed(2)}`, 1000);
  }

  // Draw all detected hands and show visual labels.
  for (const h of hands) {
    drawLandmarks(h.lm);

    const trust = shouldTrustHandedness(h.handedness, h.score);
    const label = trust ? h.handedness.toUpperCase() : `HAND ${h.index}`;
    drawHandLabel(h.lm, label);
  }

  // Assign chord vs strum hands.
  const { chordHand, strumHand, reason } = assignHands(hands);
  // Visually mark their roles (helps debugging).
  if (chordHand?.lm) drawHandLabel(chordHand.lm, "CHORD");
  if (strumHand?.lm) drawHandLabel(strumHand.lm, "STRUM");

  // Update chord only when chordHand exists.
  let chordLabel = "Chord hand: —";
  if (chordHand?.lm) {
    const { chord, label } = classifyGestureToChord(chordHand.lm, chordHand.handedness);
    chordLabel = chord ? `Chord: ${chord}` : `Chord: ${label}`;
    if (chord) setChord(chord);
  }

  // Strum detection: track RIGHT hand index finger tip (landmark[8]) Y.
  let strumLabel = "Strum: —";
  if (strumHand?.lm?.[8]) {
    const y = strumHand.lm[8].y;
    const direction = detectStrum(y);
    if (direction && currentChord) {
      lastStrumDirection = direction;
      strumLabel = `Strum: ${direction}`;
      // Trigger sound only on strum.
      playChordStrum(currentChord, direction, lastStrumVelocity).catch(() => {
        // ignore
      });
    } else if (direction) {
      lastStrumDirection = direction;
      strumLabel = `Strum: ${direction} (no chord)`;
    } else if (lastStrumDirection) {
      strumLabel = `Strum: ${lastStrumDirection}`;
    }
  } else {
    // If strum hand disappears, reset prevY only (don't affect chord state).
    prevY = null;
  }

  // Status text (kept simple). Avoid spamming debug log via throttled setStatus.
  setStatus(
    `Hands detected: ${hands.length} • ${chordLabel} • Strum hand: ${reason === "handedness" ? "RIGHT" : "(spatial)"} • ${strumLabel}`,
    { bad: !currentChord }
  );

  requestAnimationFrame(tick);
}

// --- Interaction: play chord ---
playBtn.addEventListener("click", async () => {
  // Manual play still works, but uses the currently held chord (left hand).
  if (!currentChord) {
    setStatus("No chord selected (show LEFT hand chord)", { bad: true });
    return;
  }

  // User interaction here is important: it allows AudioContext resume on mobile.
  try {
    if (!hasPlayedTestBeep) {
      hasPlayedTestBeep = true;
      debugLog("AUDIO: playing test beep");
      await playTestBeep();
    }

    setStatus(`Playing: ${currentChord}`, { bad: false });
  await playChordStrum(currentChord, "down", 1);
    debugLog(`PLAY OK: ${currentChord}`);
  } catch (err) {
    setStatus("Couldn't play sound. Check volume/silent mode and try again.", {
      bad: true,
    });
    // eslint-disable-next-line no-console
    console.warn(err);
    debugLog(`PLAY FAIL: ${currentChord} err=${err?.name ?? "Error"}`);
  }
});

// --- Boot ---
(async function main() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera not supported in this browser", { bad: true });
    return;
  }

  try {
  attachGlobalErrorDiagnostics();
  // Note: audio is created/resumed only on button click (mobile requirement).

    setStatus("Requesting camera…");
    await setupCamera();
    debugLog(
      `CAMERA OK: ${video.videoWidth}x${video.videoHeight} (secure=${window.isSecureContext})`
    );

    setStatus("Loading hand model…");
    await initHandLandmarker();
  debugLog("MODEL OK: HandLandmarker initialized");

    setStatus("Ready (show your hand)");
    running = true;
    tick();
  } catch (err) {
    setStatus("Failed to start. Check camera permission and use a local server.", {
      bad: true,
    });
    // eslint-disable-next-line no-console
    console.error(err);
  }
})();
