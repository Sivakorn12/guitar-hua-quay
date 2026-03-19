export const CHORD_FREQUENCIES = {
  C: [261.63, 329.63, 392.0],
  G: [196.0, 246.94, 293.66],
  Am: [220.0, 261.63, 329.63],
  D: [293.66, 369.99, 440.0],
  Em: [164.81, 196.0, 246.94],
  F: [174.61, 220.0, 261.63],
  A: [220.0, 277.18, 329.63],
  E: [164.81, 207.65, 246.94],
};

export const KEY_MAP = {
  "1": "C",
  "2": "G",
  "3": "Am",
  "4": "D",
  "5": "Em",
  "6": "F",
  "7": "A",
  "8": "E",
};

export const ML_DISTANCE_THRESHOLD = 0.95;
export const STABLE_FRAME_THRESHOLD = 2;
export const STRUM_COOLDOWN_MS = 150;
export const STRUM_THRESHOLD = 0.03;

export const EASY_CHORD_OPTIONS = [
  "C", "Cm", "C7", "Cmaj7",
  "C#", "C#m", "C#7", "C#maj7",
  "D", "Dm", "D7", "Dmaj7",
  "Eb", "Ebm", "Eb7", "Ebmaj7",
  "E", "Em", "E7", "Emaj7",
  "F", "Fm", "F7", "Fmaj7",
  "F#", "F#m", "F#7", "F#maj7",
  "G", "Gm", "G7", "Gmaj7",
  "Ab", "Abm", "Ab7", "Abmaj7",
  "A", "Am", "A7", "Amaj7",
  "Bb", "Bbm", "Bb7", "Bbmaj7",
  "B", "Bm", "B7", "Bmaj7",
];
