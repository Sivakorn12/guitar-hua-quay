const CHORD_DIAGRAMS = {
  C: {
    name: "C",
    frets: [null, 3, 2, 0, 1, 0],
    fingers: [null, 3, 2, null, 1, null],
    baseFret: 1,
  },
  G: {
    name: "G",
    frets: [3, 2, 0, 0, 0, 3],
    fingers: [2, 1, null, null, null, 3],
    baseFret: 1,
  },
  Am: {
    name: "Am",
    frets: [null, 0, 2, 2, 1, 0],
    fingers: [null, null, 2, 3, 1, null],
    baseFret: 1,
  },
  D: {
    name: "D",
    frets: [null, null, 0, 2, 3, 2],
    fingers: [null, null, null, 1, 3, 2],
    baseFret: 1,
  },
  Em: {
    name: "Em",
    frets: [0, 2, 2, 0, 0, 0],
    fingers: [null, 2, 3, null, null, null],
    baseFret: 1,
  },
  F: {
    name: "F",
    frets: [1, 3, 3, 2, 1, 1],
    fingers: [1, 3, 4, 2, 1, 1],
    baseFret: 1,
  },
  A: {
    name: "A",
    frets: [null, 0, 2, 2, 2, 0],
    fingers: [null, null, 1, 2, 3, null],
    baseFret: 1,
  },
  E: {
    name: "E",
    frets: [0, 2, 2, 1, 0, 0],
    fingers: [null, 2, 3, 1, null, null],
    baseFret: 1,
  },
};

export function initChordDiagram() {
  const root = document.getElementById("diagram");
  if (!root) return;

  injectStyles();

  root.innerHTML = `
    <div class="diagram-card">
      <div class="diagram-header">
        <div class="diagram-title">Chord Diagram</div>
        <div id="diagramChordName" class="diagram-name">-</div>
      </div>
      <div id="diagramGrid" class="diagram-grid-wrap"></div>
    </div>
  `;
}

export function renderChordDiagram(chord) {
  const root = document.getElementById("diagramGrid");
  const nameEl = document.getElementById("diagramChordName");
  if (!root || !nameEl) return;

  const data = CHORD_DIAGRAMS[chord];
  if (!data) {
    nameEl.textContent = "-";
    root.innerHTML = `<div class="diagram-empty">No diagram</div>`;
    return;
  }

  nameEl.textContent = data.name;
  root.innerHTML = buildDiagramHTML(data);
}

function buildDiagramHTML(data) {
  const strings = 6;
  const fretsToShow = 5;

  const topMarks = data.frets
    .map((f) => {
      if (f === null) return `<div class="diagram-topmark mute">×</div>`;
      if (f === 0) return `<div class="diagram-topmark open">○</div>`;
      return `<div class="diagram-topmark"></div>`;
    })
    .join("");

  let cells = "";
  for (let fret = 1; fret <= fretsToShow; fret++) {
    for (let string = 0; string < strings; string++) {
      const targetFret = data.frets[string];
      const finger = data.fingers[string];
      const isDot = targetFret === fret;

      cells += `
        <div class="diagram-cell">
          ${isDot ? `<div class="diagram-dot">${finger ?? ""}</div>` : ""}
        </div>
      `;
    }
  }

  return `
    <div class="diagram-basefret">${data.baseFret > 1 ? data.baseFret : ""}</div>
    <div class="diagram-top">${topMarks}</div>
    <div class="diagram-grid">
      ${cells}
    </div>
    <div class="diagram-string-labels">
      <span>E</span><span>A</span><span>D</span><span>G</span><span>B</span><span>e</span>
    </div>
  `;
}

function injectStyles() {
  if (document.getElementById("diagram-styles")) return;

  const style = document.createElement("style");
  style.id = "diagram-styles";
  style.textContent = `
    #diagram {
      position: fixed;
      left: 16px;
      bottom: 16px;
      width: 220px;
      z-index: 20;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .diagram-card {
      background: rgba(14, 20, 35, 0.86);
      backdrop-filter: blur(8px);
      color: white;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      padding: 14px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.28);
    }

    .diagram-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 10px;
    }

    .diagram-title {
      font-size: 14px;
      opacity: 0.8;
    }

    .diagram-name {
      font-size: 22px;
      font-weight: 700;
    }

    .diagram-grid-wrap {
      position: relative;
    }

    .diagram-basefret {
      position: absolute;
      left: -12px;
      top: 26px;
      font-size: 12px;
      opacity: 0.8;
    }

    .diagram-top {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 0;
      margin-left: 12px;
      margin-bottom: 6px;
    }

    .diagram-topmark {
      text-align: center;
      font-size: 16px;
      height: 18px;
      line-height: 18px;
      opacity: 0.9;
    }

    .diagram-grid {
      margin-left: 12px;
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      grid-template-rows: repeat(5, 30px);
      border-top: 3px solid rgba(255,255,255,0.75);
      border-left: 1px solid rgba(255,255,255,0.28);
      border-right: 1px solid rgba(255,255,255,0.28);
      border-bottom: 1px solid rgba(255,255,255,0.28);
    }

    .diagram-cell {
      position: relative;
      border-right: 1px solid rgba(255,255,255,0.25);
      border-bottom: 1px solid rgba(255,255,255,0.25);
    }

    .diagram-dot {
      position: absolute;
      width: 22px;
      height: 22px;
      border-radius: 999px;
      background: rgba(255,255,255,0.9);
      color: rgba(14, 20, 35, 1);
      font-size: 11px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      top: 3px;
      left: 50%;
      transform: translateX(-50%);
    }

    .diagram-string-labels {
      margin-left: 12px;
      margin-top: 8px;
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      font-size: 11px;
      opacity: 0.75;
      text-align: center;
    }

    .diagram-empty {
      font-size: 13px;
      opacity: 0.75;
      padding: 12px 0 4px;
    }
  `;
  document.head.appendChild(style);
}
