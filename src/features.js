export function getAngle(a, b, c) {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;

  const dot = abx * cbx + aby * cby;
  const lab = Math.hypot(abx, aby);
  const lcb = Math.hypot(cbx, cby);

  return Math.acos(dot / (lab * lcb + 0.0001));
}

export function extractFeatures(lm) {
  if (!lm || lm.length < 21) return [];

  const wrist = lm[0];
  const indexBase = lm[5];
  const pinkyBase = lm[17];

  const baseX = normalizeVec({
    x: indexBase.x - wrist.x,
    y: indexBase.y - wrist.y,
  });

  const baseY = normalizeVec({
    x: pinkyBase.x - wrist.x,
    y: pinkyBase.y - wrist.y,
  });

  function project(p) {
    const vx = p.x - wrist.x;
    const vy = p.y - wrist.y;
    return {
      x: vx * baseX.x + vy * baseX.y,
      y: vx * baseY.x + vy * baseY.y,
    };
  }

  function fingerCurl(mcp, pip, tip) {
    return getAngle(lm[mcp], lm[pip], lm[tip]);
  }

  // ✅ 4 นิ้วหลักเท่านั้น
  const curls = [
    fingerCurl(5, 6, 8),    // index
    fingerCurl(9, 10, 12),  // middle
    fingerCurl(13, 14, 16), // ring
    fingerCurl(17, 18, 20), // pinky
  ];

  // ✅ ปลายนิ้ว 4 นิ้วหลักเท่านั้น
  const tips = [8, 12, 16, 20];
  const positions = tips.flatMap((i) => {
    const p = project(lm[i]);
    return [p.x, p.y];
  });

  return [...curls, ...positions];
}

function normalizeVec(v) {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}
