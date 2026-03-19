import {
  KEY_MAP,
  ML_DISTANCE_THRESHOLD,
} from "./config.js";
import { extractFeatures } from "./features.js";

const STORAGE_KEY = "virtual-guitar-training-data";
const EASY_SYMBOLS_KEY = "virtual-guitar-easy-symbols";

let TRAINING_DATA = loadTrainingData();
let EASY_SYMBOLS = loadEasySymbols();

let lastChordHandLandmarks = null;
let lastChordHandedness = "Left";
let lastFeatures = null;
let currentTrainingChord = null;

const listeners = new Set();

const SAFE_FALLBACK_CHORDS = new Set(["C", "G", "Am", "D", "Em"]);
const MIN_SAMPLES_PER_CHORD = 4;
const K = 3;
const MIN_MARGIN = 0.18;

function emitChange() {
  const payload = {
    stats: getTrainingStats(),
    total: TRAINING_DATA.length,
    currentTrainingChord,
    easySymbols: EASY_SYMBOLS,
  };
  listeners.forEach((fn) => fn(payload));
}

export function subscribeTrainingState(fn) {
  listeners.add(fn);
  fn({
    stats: getTrainingStats(),
    total: TRAINING_DATA.length,
    currentTrainingChord,
    easySymbols: EASY_SYMBOLS,
  });
  return () => listeners.delete(fn);
}

export function setCurrentTrainingChord(chord) {
  currentTrainingChord = chord;
  emitChange();
}

// =====================
// Finger detection
// =====================
export function isUp(lm, tip, pip) {
  return lm[tip].y < lm[pip].y;
}

export function isThumbUp(lm, handedness = "Left") {
  const tipX = lm[4].x;
  const ipX = lm[3].x;

  if (handedness === "Left") return tipX > ipX;
  if (handedness === "Right") return tipX < ipX;

  return Math.abs(tipX - ipX) > 0.04;
}

// advanced mode uses 4 fingers
export function getFingerState(lm) {
  return {
    index: isUp(lm, 8, 6),
    middle: isUp(lm, 12, 10),
    ring: isUp(lm, 16, 14),
    pinky: isUp(lm, 20, 18),
  };
}

// easy mode uses 5 fingers
export function getEasyFingerState(lm, handedness = "Left") {
  return {
    thumb: isThumbUp(lm, handedness),
    index: isUp(lm, 8, 6),
    middle: isUp(lm, 12, 10),
    ring: isUp(lm, 16, 14),
    pinky: isUp(lm, 20, 18),
  };
}

function easyStateToPattern(state) {
  return [
    state.thumb ? 1 : 0,
    state.index ? 1 : 0,
    state.middle ? 1 : 0,
    state.ring ? 1 : 0,
    state.pinky ? 1 : 0,
  ].join("");
}

// =====================
// Easy mode custom symbols
// =====================
export function setLastChordHandLandmarks(lm, handedness = "Left") {
  lastChordHandLandmarks = lm;
  lastChordHandedness = handedness || "Left";
}

export function getEasySymbols() {
  return { ...EASY_SYMBOLS };
}

export function saveEasySymbol(chordName) {
  const chord = normalizeChordName(chordName);
  if (!chord || !lastChordHandLandmarks) return false;

  const state = getEasyFingerState(lastChordHandLandmarks, lastChordHandedness);
  const pattern = easyStateToPattern(state);

  EASY_SYMBOLS[chord] = pattern;
  currentTrainingChord = chord;
  saveEasySymbols();
  emitChange();

  console.log(`[EASY] saved symbol ${chord} = ${pattern}`);
  return true;
}

export function deleteEasySymbol(chordName) {
  const chord = normalizeChordName(chordName);
  if (!chord || !EASY_SYMBOLS[chord]) return false;

  delete EASY_SYMBOLS[chord];
  saveEasySymbols();
  emitChange();

  console.log(`[EASY] deleted symbol ${chord}`);
  return true;
}

export function detectChordEasy(lm, handedness = "Left") {
  const state = getEasyFingerState(lm, handedness);
  const pattern = easyStateToPattern(state);

  for (const [chord, savedPattern] of Object.entries(EASY_SYMBOLS)) {
    if (savedPattern === pattern) {
      return chord;
    }
  }

  return null;
}

export function getEasySymbolPattern(lm, handedness = "Left") {
  const state = getEasyFingerState(lm, handedness);
  return easyStateToPattern(state);
}

export function clearEasySymbols() {
  EASY_SYMBOLS = {};
  localStorage.removeItem(EASY_SYMBOLS_KEY);
  emitChange();
  console.log("[EASY] cleared all easy symbols");
}

function normalizeChordName(value) {
  if (!value) return "";
  return String(value).trim();
}

function saveEasySymbols() {
  localStorage.setItem(EASY_SYMBOLS_KEY, JSON.stringify(EASY_SYMBOLS));
}

function loadEasySymbols() {
  try {
    const raw = localStorage.getItem(EASY_SYMBOLS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// =====================
// Advanced mode
// =====================
export function detectChordShape(lm) {
  const f = getFingerState(lm);

  if (!f.index && f.middle && f.ring && !f.pinky) return "Am";
  if (f.index && f.middle && !f.ring && !f.pinky) return "G";
  if (!f.index && !f.middle && f.ring && !f.pinky) return "C";
  if (f.index && !f.middle && !f.ring && !f.pinky) return "D";
  if (!f.index && !f.middle && !f.ring && !f.pinky) return "Em";

  return null;
}

export function computeBasis(lm) {
  const wrist = lm[0];
  const indexBase = lm[5];
  const pinkyBase = lm[17];

  const x = normalizeVec({
    x: indexBase.x - wrist.x,
    y: indexBase.y - wrist.y,
  });

  const y = normalizeVec({
    x: pinkyBase.x - wrist.x,
    y: pinkyBase.y - wrist.y,
  });

  return { wrist, x, y };
}

function normalizeVec(v) {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

export function projectPoint(p, b) {
  const vx = p.x - b.wrist.x;
  const vy = p.y - b.wrist.y;

  return {
    x: vx * b.x.x + vy * b.x.y,
    y: vx * b.y.x + vy * b.y.y,
  };
}

export function detectChordGrid(lm) {
  const b = computeBasis(lm);
  const tipIds = [8, 12, 16];

  const projected = tipIds.map((i) => projectPoint(lm[i], b));
  const avgY =
    projected.reduce((sum, p) => sum + p.y, 0) / projected.length;
  const avgX =
    projected.reduce((sum, p) => sum + p.x, 0) / projected.length;

  if (avgY < -0.05) return "C";
  if (avgY < -0.01) return "G";
  if (avgY < 0.03) return "Am";

  if (avgX < -0.02) return "D";
  if (avgX < 0.01) return "Em";

  return null;
}

export function weightedDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const w = i < 4 ? 2.2 : 1.0;
    sum += Math.abs(a[i] - b[i]) * w;
  }
  return sum / a.length;
}

function getEligibleTrainingData() {
  const stats = getTrainingStats();
  return TRAINING_DATA.filter(
    (s) => (stats[s.chord] || 0) >= MIN_SAMPLES_PER_CHORD
  );
}

export function predictChord(features) {
  const eligible = getEligibleTrainingData();
  if (!eligible.length) return null;

  const ranked = eligible
    .map((sample) => ({
      chord: sample.chord,
      distance: weightedDistance(features, sample.features),
    }))
    .sort((a, b) => a.distance - b.distance);

  const nearest = ranked.slice(0, Math.min(K, ranked.length));
  if (!nearest.length) return null;

  const bestOverall = ranked[0];
  const secondOverall = ranked[1] || null;

  if (!bestOverall || bestOverall.distance > ML_DISTANCE_THRESHOLD) {
    return null;
  }

  const buckets = {};
  for (const item of nearest) {
    if (!buckets[item.chord]) {
      buckets[item.chord] = { count: 0, totalDistance: 0 };
    }
    buckets[item.chord].count += 1;
    buckets[item.chord].totalDistance += item.distance;
  }

  const scored = Object.entries(buckets)
    .map(([chord, v]) => ({
      chord,
      count: v.count,
      avgDistance: v.totalDistance / v.count,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.avgDistance - b.avgDistance;
    });

  const best = scored[0];
  if (!best) return null;

  if (secondOverall) {
    const margin = secondOverall.distance - bestOverall.distance;
    if (margin < MIN_MARGIN) {
      return null;
    }
  }

  return {
    chord: best.chord,
    distance: bestOverall.distance,
    neighbors: nearest,
  };
}

export function getSmoothedFeatures(lm) {
  let features = extractFeatures(lm);

  if (lastFeatures && lastFeatures.length === features.length) {
    features = features.map((v, i) => v * 0.45 + lastFeatures[i] * 0.55);
  }

  lastFeatures = features;
  return features;
}

export function saveSample(chord) {
  if (!lastChordHandLandmarks) return false;

  const features = getSmoothedFeatures(lastChordHandLandmarks);
  TRAINING_DATA.push({ chord, features });

  saveTrainingData();
  emitChange();

  console.log(`[LEARN] saved ${chord}, total=${TRAINING_DATA.length}`);
  return true;
}

export function clearTrainingData() {
  TRAINING_DATA = [];
  localStorage.removeItem(STORAGE_KEY);
  emitChange();
  console.log("[LEARN] cleared all training data");
}

export function getTrainingStats() {
  const stats = {};
  for (const s of TRAINING_DATA) {
    stats[s.chord] = (stats[s.chord] || 0) + 1;
  }
  return stats;
}

export function handleTrainingHotkey(mode, key) {
  const chord = KEY_MAP[key];
  if (!chord) return false;

  setCurrentTrainingChord(chord);

  if (mode === "easy") {
    return saveEasySymbol(chord);
  }

  return saveSample(chord);
}

export function handleClearByMode(mode) {
  if (mode === "easy") {
    clearEasySymbols();
    return true;
  }

  clearTrainingData();
  return true;
}

export function detectHybridChord(lm) {
  const features = getSmoothedFeatures(lm);
  const ml = predictChord(features);

  if (ml) {
    return { chord: ml.chord, source: "ml", distance: ml.distance };
  }

  const shape = detectChordShape(lm);
  if (shape && SAFE_FALLBACK_CHORDS.has(shape)) {
    return { chord: shape, source: "shape", distance: null };
  }

  const grid = detectChordGrid(lm);
  if (grid && SAFE_FALLBACK_CHORDS.has(grid)) {
    return { chord: grid, source: "grid", distance: null };
  }

  return { chord: null, source: null, distance: null };
}

function saveTrainingData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(TRAINING_DATA));
}

function loadTrainingData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
