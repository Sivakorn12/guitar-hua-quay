# guitar-hua-quay

A tiny, framework-free demo that uses **MediaPipe Hands (JS)** to detect a single hand from your webcam, classify a few simple gestures, map them to **guitar chords (C, G, Am)**, and play sounds.

## Files

- `index.html` – UI (video + overlay + chord label + play button)
- `style.css` – centered layout styling
- `script.js` – camera + MediaPipe + gesture logic + audio playback

## Audio files (required)

Place 3 chord audio files here:

```
audio/C.mp3
audio/G.mp3
audio/Am.mp3
```

They can be any short recordings (mp3). The app preloads and plays them when you press **Play Chord**.

## Run locally

Webcam access and ESM module loading are usually blocked on `file://`, so run a small local server.

If you have Python 3:

```bash
cd guitar-hua-quay
python3 -m http.server 5173
```

Then open:

```text
http://localhost:5173
```

## Gestures

Very simple heuristic (no training):

- **Fist-ish** (0–1 extended fingers) → **C**
- **Two fingers** → **G**
- **Open hand** (4–5 extended fingers) → **Am**

If the gesture is unclear, it shows **No hand detected** or **Unclear** and disables the play button.