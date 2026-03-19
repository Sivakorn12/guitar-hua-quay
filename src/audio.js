import { CHORD_FREQUENCIES } from "./config.js";

let audioCtx = null;
let masterGain = null;

const NOTE_TO_SEMITONE = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function clampChordName(name) {
  return String(name || "").trim();
}

function parseChordName(chordName) {
  const name = clampChordName(chordName);
  if (!name) return null;

  const match = name.match(/^([A-G](?:#|b)?)(maj7|m7|m|7)?$/i);
  if (!match) return null;

  const rawRoot = match[1];
  const quality = match[2] || "";

  const root =
    rawRoot.charAt(0).toUpperCase() +
    (rawRoot.charAt(1) ? rawRoot.charAt(1) : "");

  const semitone = NOTE_TO_SEMITONE[root];
  if (semitone == null) return null;

  return { root, semitone, quality };
}

function buildChordFrequencies(chordName) {
  if (CHORD_FREQUENCIES[chordName]) {
    return CHORD_FREQUENCIES[chordName];
  }

  const parsed = parseChordName(chordName);
  if (!parsed) return null;

  const { semitone, quality } = parsed;

  // ตั้ง root แถว C3–B3
  const rootMidi = 48 + semitone;

  let intervals;
  switch (quality) {
    case "m":
      intervals = [0, 3, 7];
      break;
    case "7":
      intervals = [0, 4, 7, 10];
      break;
    case "maj7":
      intervals = [0, 4, 7, 11];
      break;
    case "m7":
      intervals = [0, 3, 7, 10];
      break;
    default:
      intervals = [0, 4, 7];
      break;
  }

  return intervals.map((i) => midiToFreq(rootMidi + i));
}

export function getAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.9;
    masterGain.connect(audioCtx.destination);
  }
  return audioCtx;
}

export async function playChordStrum(chord, dir = "down") {
  const freqs = buildChordFrequencies(chord);
  if (!freqs?.length) return;

  const ac = getAudio();
  await ac.resume();

  const order = dir === "down" ? freqs : [...freqs].reverse();
  const now = ac.currentTime;

  order.forEach((f, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();

    osc.type = "triangle";
    osc.frequency.value = f;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(now + i * 0.02);
    osc.stop(now + 1);
  });
}
