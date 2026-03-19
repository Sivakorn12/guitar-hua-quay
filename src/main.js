import { DrawingUtils, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
import { initModel, setupCamera } from "./model.js";
import { playChordStrum } from "./audio.js";
import {
  detectHybridChord,
  detectChordEasy,
  setLastChordHandLandmarks,
  getTrainingStats,
  handleTrainingHotkey,
  handleClearByMode,
  getEasySymbolPattern,
} from "./chords.js";
import { detectStrum, resetStrum } from "./strum.js";
import { STABLE_FRAME_THRESHOLD } from "./config.js";
import { initTrainerUI, refreshTrainerUI } from "./trainer.js";
import { initChordDiagram, renderChordDiagram } from "./diagram.js";

const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const chordEl = document.getElementById("chord");
const statusEl = document.getElementById("status");

let handLandmarker = null;
let currentChord = null;

let lastStable = null;
let stableCount = 0;

const INVERT_HANDEDNESS = false;
let mode = "advanced";

function drawHand(lm) {
  const d = new DrawingUtils(ctx);
  d.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS);
  d.drawLandmarks(lm);
}

function drawHandRoleLabel(lm, role) {
  if (!lm?.length) return;

  const x = lm[0].x * canvas.width;
  const y = lm[0].y * canvas.height - 18;

  ctx.save();
  ctx.font = "bold 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  const text = role.toUpperCase();
  const paddingX = 10;
  const textWidth = ctx.measureText(text).width;
  const w = textWidth + paddingX * 2;
  const h = 24;

  ctx.fillStyle =
    role === "chord"
      ? "rgba(59, 130, 246, 0.88)"
      : "rgba(234, 179, 8, 0.88)";

  ctx.beginPath();
  roundRect(ctx, x - w / 2, y - h / 2, w, h, 12);
  ctx.fill();

  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);

  ctx.restore();
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function updateStableChord(candidate) {
  if (!candidate) {
    stableCount = 0;
    lastStable = null;
    return null;
  }

  if (candidate === lastStable) {
    stableCount++;
  } else {
    stableCount = 1;
    lastStable = candidate;
  }

  if (stableCount >= STABLE_FRAME_THRESHOLD) {
    return candidate;
  }

  return null;
}

function getHandCenterX(lm) {
  const xs = lm.map((p) => p.x);
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function normalizeHandedness(label) {
  if (!label) return "Unknown";
  if (!INVERT_HANDEDNESS) return label;
  if (label === "Left") return "Right";
  if (label === "Right") return "Left";
  return label;
}

function assignHands(hands) {
  if (!hands.length) {
    return { chordHand: null, strumHand: null };
  }

  if (hands.length === 1) {
    return {
      chordHand: hands[0],
      strumHand: null,
    };
  }

  let leftHand = hands.find((h) => normalizeHandedness(h.handedness) === "Left");
  let rightHand = hands.find((h) => normalizeHandedness(h.handedness) === "Right");

  if (!leftHand || !rightHand) {
    const sorted = [...hands].sort((a, b) => a.centerX - b.centerX);
    leftHand = leftHand || sorted[1];
    rightHand = rightHand || sorted[0];
  }

  return {
    chordHand: leftHand,
    strumHand: rightHand,
  };
}

function formatStats() {
  const stats = getTrainingStats();
  const entries = Object.entries(stats);
  if (!entries.length) return "no samples";
  return entries.map(([k, v]) => `${k}:${v}`).join(" ");
}

// =====================
// Mode Toggle
// =====================
let modeBtn = null;

function initModeToggle() {
  if (document.getElementById("modeToggle")) {
    modeBtn = document.getElementById("modeToggle");
    return;
  }

  modeBtn = document.createElement("button");
  modeBtn.id = "modeToggle";
  modeBtn.textContent = "Mode: Advanced";
  document.body.appendChild(modeBtn);

  const style = document.createElement("style");
  style.id = "modeToggleStyles";
  style.textContent = `
    #modeToggle {
      position: fixed;
      top: 16px;
      left: 16px;
      z-index: 35;
      border: 0;
      border-radius: 12px;
      padding: 10px 14px;
      background: rgba(14, 20, 35, 0.86);
      color: white;
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255,255,255,0.12);
      box-shadow: 0 10px 24px rgba(0,0,0,0.2);
      cursor: pointer;
      font: 600 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
  `;
  document.head.appendChild(style);

  modeBtn.addEventListener("click", () => {
    mode = mode === "easy" ? "advanced" : "easy";
    modeBtn.textContent = mode === "easy" ? "Mode: Easy" : "Mode: Advanced";

    lastStable = null;
    stableCount = 0;
    currentChord = null;
    chordEl.textContent = "—";
    renderChordDiagram(null);

    refreshTrainerUI();
  });
}

// =====================
// Debug HUD
// =====================
let confidenceEl = null;
let hintEl = null;

function initDebugHud() {
  if (document.getElementById("debugHud")) return;

  const hud = document.createElement("div");
  hud.id = "debugHud";
  hud.innerHTML = `
    <div class="debug-card">
      <div class="debug-row">
        <span class="debug-label">Confidence</span>
        <div class="debug-bar-wrap">
          <div id="debugConfidenceBar" class="debug-bar"></div>
        </div>
        <span id="debugConfidenceText" class="debug-value">0%</span>
      </div>
      <div class="debug-row hint-row">
        <span class="debug-label">Hint</span>
        <span id="debugHintText" class="debug-hint">-</span>
      </div>
    </div>
  `;
  document.body.appendChild(hud);

  const style = document.createElement("style");
  style.id = "debugHudStyles";
  style.textContent = `
    #debugHud {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 30;
      width: min(340px, calc(100vw - 32px));
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .debug-card {
      background: rgba(14, 20, 35, 0.82);
      backdrop-filter: blur(8px);
      color: white;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 14px;
      padding: 12px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.22);
    }

    .debug-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .hint-row {
      margin-top: 10px;
      align-items: flex-start;
    }

    .debug-label {
      width: 72px;
      font-size: 12px;
      opacity: 0.75;
      flex-shrink: 0;
    }

    .debug-bar-wrap {
      flex: 1;
      height: 10px;
      background: rgba(255,255,255,0.1);
      border-radius: 999px;
      overflow: hidden;
    }

    .debug-bar {
      height: 100%;
      width: 0%;
      border-radius: 999px;
      background: rgba(255,255,255,0.9);
      transition: width 120ms ease;
    }

    .debug-value {
      width: 42px;
      text-align: right;
      font-size: 12px;
      opacity: 0.9;
      flex-shrink: 0;
    }

    .debug-hint {
      font-size: 12px;
      opacity: 0.9;
      line-height: 1.35;
      white-space: pre-line;
    }

    @media (max-width: 768px) {
      #debugHud {
        top: auto;
        right: 16px;
        left: 16px;
        bottom: 220px;
        width: auto;
      }
    }
  `;
  document.head.appendChild(style);

  confidenceEl = document.getElementById("debugConfidenceBar");
  hintEl = document.getElementById("debugHintText");
}

function setConfidence(distance, source) {
  const textEl = document.getElementById("debugConfidenceText");
  if (!confidenceEl || !textEl) return;

  let score = 0;

  if (mode === "easy") {
    score = source === "easy" ? 0.88 : 0;
  } else if (source === "ml" && typeof distance === "number") {
    score = Math.max(0, Math.min(1, 1 - distance / 1.0));
  } else if (source === "shape") {
    score = 0.72;
  } else if (source === "grid") {
    score = 0.45;
  } else {
    score = 0;
  }

  const pct = Math.round(score * 100);
  confidenceEl.style.width = `${pct}%`;
  textEl.textContent = `${pct}%`;
}

function setHint(text) {
  if (!hintEl) return;
  hintEl.textContent = text || "-";
}

function getHint(result, shownChord, handCount, handedness) {
  if (handCount === 1) {
    return "One hand detected: chord only mode";
  }

  if (mode === "easy") {
    const pattern = lastPatternText || "-";
    if (result?.chord) {
      return `Easy symbol matched: ${shownChord}\nPattern: ${pattern}\nPress 1–8 to save current symbol`;
    }
    return `No symbol match yet\nPattern: ${pattern}\nPress 1–8 to assign this symbol`;
  }

  if (!result?.source) {
    return "No confident chord match yet";
  }

  if (result.source === "ml" && typeof result.distance === "number") {
    if (result.distance < 0.35) {
      return `Very close match for ${shownChord}`;
    }
    if (result.distance < 0.6) {
      return `Looks like ${shownChord}, keep the hand steady`;
    }
    return `Almost ${shownChord}, adjust finger shape slightly`;
  }

  if (result.source === "shape") {
    return `Shape-based guess: ${shownChord}`;
  }

  if (result.source === "grid") {
    return `Rough position guess: ${shownChord}`;
  }

  return "-";
}

let lastPatternText = "-";

function attachModeAwareHotkeys() {
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "x") {
      handleClearByMode(mode);
      return;
    }

    handleTrainingHotkey(mode, e.key);
  });
}

async function loop() {
  const res = handLandmarker.detectForVideo(video, performance.now());

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!res.landmarks?.length) {
    resetStrum();
    setStatus(`No hand • ${formatStats()} • ${mode}`);
    setConfidence(null, null);
    setHint("Left hand = chord, right hand = strum");
    requestAnimationFrame(loop);
    return;
  }

  const hands = res.landmarks.map((lm, i) => ({
    lm,
    handedness: res.handednesses?.[i]?.[0]?.categoryName || "Unknown",
    centerX: getHandCenterX(lm),
  }));

  hands.forEach((h) => drawHand(h.lm));

  const { chordHand, strumHand } = assignHands(hands);

  if (chordHand?.lm) {
    drawHandRoleLabel(chordHand.lm, "chord");
  }
  if (hands.length >= 2 && strumHand?.lm) {
    drawHandRoleLabel(strumHand.lm, "strum");
  }

  if (chordHand?.lm) {
    setLastChordHandLandmarks(chordHand.lm, normalizeHandedness(chordHand.handedness));

    let result;
    if (mode === "easy") {
      const normalizedHand = normalizeHandedness(chordHand.handedness);
      const chord = detectChordEasy(chordHand.lm, normalizedHand);
      lastPatternText = getEasySymbolPattern(chordHand.lm, normalizedHand);
      result = {
        chord,
        source: chord ? "easy" : null,
        distance: null,
      };
    } else {
      lastPatternText = "-";
      result = detectHybridChord(chordHand.lm);
    }

    const accepted = updateStableChord(result.chord);

    if (accepted) {
      currentChord = accepted;
      chordEl.textContent = accepted;
      renderChordDiagram(accepted);
    }

    const shownChord = accepted || currentChord || result.chord || "-";

    setConfidence(result.distance, result.source);
    setHint(
      getHint(
        result,
        shownChord,
        hands.length,
        normalizeHandedness(chordHand.handedness)
      )
    );

    if (result.source === "ml" && result.distance != null) {
      setStatus(
        `Mode: ${mode} • Chord: ${shownChord} • ML ${result.distance.toFixed(2)} • hands:${hands.length} • ${formatStats()}`
      );
    } else if (result.source) {
      setStatus(
        `Mode: ${mode} • Chord: ${shownChord} • ${result.source} • hands:${hands.length} • ${formatStats()}`
      );
    } else {
      setStatus(
        `Mode: ${mode} • Chord: ${shownChord} • hands:${hands.length} • ${formatStats()}`
      );
    }
  } else {
    setConfidence(null, null);
    setHint("Show left hand for chord detection");
  }

  if (hands.length >= 2 && strumHand?.lm?.[8]) {
    const dir = detectStrum(strumHand.lm[8].y);
    if (dir && currentChord) {
      playChordStrum(currentChord, dir);
    }
  } else {
    resetStrum();
  }

  requestAnimationFrame(loop);
}

(async () => {
  attachModeAwareHotkeys();

  initChordDiagram();
  initDebugHud();
  initModeToggle();
  initTrainerUI({
    getMode: () => mode,
    getEasyPattern: () => lastPatternText || "-",
  });
  
  await setupCamera(video);
  handLandmarker = await initModel();

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  setStatus("Ready");
  renderChordDiagram(null);
  setConfidence(null, null);
  setHint("Left hand = chord, right hand = strum");
  loop();
})();
