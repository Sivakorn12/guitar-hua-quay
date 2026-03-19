import { KEY_MAP, EASY_CHORD_OPTIONS } from "./config.js";
import {
  subscribeTrainingState,
  setCurrentTrainingChord,
  saveSample,
  clearTrainingData,
  saveEasySymbol,
  clearEasySymbols,
  deleteEasySymbol,
} from "./chords.js";

let currentMode = "advanced";
let getCurrentPattern = () => "-";
let refreshTrainerUIFn = null;

export function refreshTrainerUI() {
  if (typeof refreshTrainerUIFn === "function") {
    refreshTrainerUIFn();
  }
}

export function initTrainerUI(options = {}) {
  currentMode = options.getMode ? options.getMode() : "advanced";
  getCurrentPattern = options.getEasyPattern || (() => "-");

  const root = document.getElementById("trainer");
  if (!root) return;

  root.innerHTML = `
    <div class="trainer-card">
      <div class="trainer-header">
        <div>
          <div class="trainer-title">Chord Trainer</div>
          <div id="trainerSubtitle" class="trainer-subtitle">Loading...</div>
        </div>
        <button id="clearTrainingBtn" class="trainer-clear">Clear</button>
      </div>

      <div id="trainerMode" class="trainer-mode">Mode: -</div>
      <div id="trainerCurrent" class="trainer-current">Training: -</div>
      <div id="trainerPattern" class="trainer-pattern">Pattern: -</div>

      <div id="trainerCustomEasy" class="trainer-custom-easy"></div>
      <div id="trainerKeys" class="trainer-keys"></div>
      <div id="trainerStats" class="trainer-stats"></div>
    </div>
  `;

  injectTrainerStyles();

  const keysWrap = root.querySelector("#trainerKeys");
  const statsWrap = root.querySelector("#trainerStats");
  const currentWrap = root.querySelector("#trainerCurrent");
  const subtitleWrap = root.querySelector("#trainerSubtitle");
  const modeWrap = root.querySelector("#trainerMode");
  const patternWrap = root.querySelector("#trainerPattern");
  const clearBtn = root.querySelector("#clearTrainingBtn");
  const customEasyWrap = root.querySelector("#trainerCustomEasy");

  let latestStats = {};
  let latestTotal = 0;
  let latestTrainingChord = "-";
  let latestEasySymbols = {};

  function renderStats() {
    const uniqueDefaultChords = Object.values(KEY_MAP).filter(
      (v, i, arr) => arr.indexOf(v) === i
    );

    if (currentMode === "easy") {
      const entries = Object.entries(latestEasySymbols || {});
      statsWrap.innerHTML = `
        <div class="trainer-total">Total symbols: ${entries.length}</div>
        <div class="trainer-badges">
          ${
            entries.length
              ? entries
                  .map(
                    ([chord, pattern]) => `
                      <div class="trainer-badge trainer-badge-row">
                        <span>${escapeHtml(chord)}: ${pattern}</span>
                        <button class="trainer-delete-btn" data-chord="${escapeHtml(chord)}">×</button>
                      </div>
                    `
                  )
                  .join("")
              : `<div class="trainer-empty">No symbols assigned yet</div>`
          }
        </div>
      `;

      statsWrap.querySelectorAll(".trainer-delete-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const chord = btn.getAttribute("data-chord");
          if (chord) deleteEasySymbol(chord);
        });
      });
    } else {
      statsWrap.innerHTML = `
        <div class="trainer-total">Total samples: ${latestTotal}</div>
        <div class="trainer-badges">
          ${uniqueDefaultChords
            .map((chord) => {
              const count = latestStats[chord] || 0;
              return `<div class="trainer-badge">${chord}: ${count}</div>`;
            })
            .join("")}
        </div>
      `;
    }
  }

  function refreshStaticUI() {
    const mode = options.getMode ? options.getMode() : currentMode;
    currentMode = mode;

    modeWrap.textContent = `Mode: ${mode}`;
    subtitleWrap.textContent =
      mode === "easy"
        ? "Choose a chord from dropdown and assign it to the current symbol"
        : "Click a chord or press 1–8 to save a sample";

    patternWrap.textContent =
      mode === "easy"
        ? `Pattern: ${getCurrentPattern()}`
        : "Pattern: -";

    currentWrap.textContent = `Training: ${latestTrainingChord || "-"}`;

    customEasyWrap.innerHTML =
      mode === "easy"
        ? `
          <div class="trainer-custom-row">
            <select id="trainerChordSelect" class="trainer-select">
              ${EASY_CHORD_OPTIONS.map(
                (chord) => `<option value="${escapeHtml(chord)}">${chord}</option>`
              ).join("")}
            </select>
            <button id="trainerSaveCustomBtn" class="trainer-action">Set Symbol</button>
          </div>
        `
        : "";

    if (mode === "easy") {
      const select = document.getElementById("trainerChordSelect");
      const saveBtn = document.getElementById("trainerSaveCustomBtn");

      saveBtn?.addEventListener("click", () => {
        const value = select?.value?.trim();
        if (!value) return;
        setCurrentTrainingChord(value);
        saveEasySymbol(value);
      });
    }

    renderStats();
  }

  refreshTrainerUIFn = refreshStaticUI;

  Object.entries(KEY_MAP).forEach(([key, chord]) => {
    const btn = document.createElement("button");
    btn.className = "trainer-key";
    btn.innerHTML = `<span class="trainer-key-kbd">${key}</span><span>${chord}</span>`;
    btn.addEventListener("click", () => {
      setCurrentTrainingChord(chord);

      const mode = options.getMode ? options.getMode() : currentMode;
      currentMode = mode;

      if (mode === "easy") {
        saveEasySymbol(chord);
      } else {
        saveSample(chord);
      }
    });
    keysWrap.appendChild(btn);
  });

  clearBtn.addEventListener("click", () => {
    const mode = options.getMode ? options.getMode() : currentMode;
    currentMode = mode;

    if (mode === "easy") {
      clearEasySymbols();
    } else {
      clearTrainingData();
    }
  });

  subscribeTrainingState(({ stats, total, currentTrainingChord, easySymbols }) => {
    latestStats = stats || {};
    latestTotal = total || 0;
    latestTrainingChord = currentTrainingChord || "-";
    latestEasySymbols = easySymbols || {};

    refreshStaticUI();
  });

  refreshStaticUI();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function injectTrainerStyles() {
  if (document.getElementById("trainer-styles")) return;

  const style = document.createElement("style");
  style.id = "trainer-styles";
  style.textContent = `
    #trainer {
      position: fixed;
      right: 16px;
      bottom: 16px;
      width: 360px;
      z-index: 20;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .trainer-card {
      background: rgba(14, 20, 35, 0.86);
      backdrop-filter: blur(8px);
      color: white;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      padding: 14px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.28);
    }

    .trainer-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }

    .trainer-title {
      font-size: 16px;
      font-weight: 700;
    }

    .trainer-subtitle {
      font-size: 12px;
      opacity: 0.75;
      margin-top: 2px;
    }

    .trainer-clear {
      border: 0;
      border-radius: 10px;
      padding: 8px 10px;
      cursor: pointer;
      background: rgba(255,255,255,0.12);
      color: white;
    }

    .trainer-mode {
      font-size: 12px;
      opacity: 0.8;
      margin-bottom: 6px;
    }

    .trainer-current {
      font-size: 13px;
      margin-bottom: 6px;
      opacity: 0.9;
    }

    .trainer-pattern {
      font-size: 12px;
      opacity: 0.8;
      margin-bottom: 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    }

    .trainer-custom-easy {
      margin-bottom: 12px;
    }

    .trainer-custom-row {
      display: flex;
      gap: 8px;
    }

    .trainer-select {
      flex: 1;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(255,255,255,0.08);
      color: white;
      border-radius: 10px;
      padding: 10px 12px;
      outline: none;
    }

    .trainer-select option {
      color: black;
    }

    .trainer-action {
      border: 0;
      border-radius: 10px;
      padding: 10px 12px;
      cursor: pointer;
      background: rgba(255,255,255,0.14);
      color: white;
      white-space: nowrap;
    }

    .trainer-keys {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 12px;
    }

    .trainer-key {
      border: 0;
      border-radius: 12px;
      padding: 10px 8px;
      cursor: pointer;
      background: rgba(255,255,255,0.1);
      color: white;
      display: flex;
      flex-direction: column;
      gap: 4px;
      align-items: center;
      justify-content: center;
    }

    .trainer-key-kbd {
      font-size: 11px;
      opacity: 0.7;
    }

    .trainer-total {
      font-size: 13px;
      margin-bottom: 8px;
      opacity: 0.9;
    }

    .trainer-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .trainer-badge {
      font-size: 12px;
      background: rgba(255,255,255,0.08);
      border-radius: 999px;
      padding: 6px 10px;
    }

    .trainer-badge-row {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding-right: 6px;
    }

    .trainer-delete-btn {
      border: 0;
      background: transparent;
      color: white;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      opacity: 0.8;
    }

    .trainer-empty {
      font-size: 12px;
      opacity: 0.7;
    }
  `;
  document.head.appendChild(style);
}
