const stage = document.getElementById('stage');
const slider = document.getElementById('sittingSlider');
const hoursLabel = document.getElementById('hoursLabel');
const tooltip = document.getElementById('chairTooltip');

let chairs = [];
let items = [];

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return h;
}

function seededShuffle(arr, rand) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function loadChairs() {
  try {
    const res = await fetch('chairs.json');
    if (!res.ok) throw new Error('bad response');
    const data = await res.json();
    chairs = data.chairs || [];
    await buildStage();
    applyFilter();
  } catch (err) {
    stage.innerHTML = '<p style="text-align:center;padding-top:40vh;color:#999">לא הצלחנו לטעון את קטלוג הכיסאות. נסו לרענן את הדף.</p>';
  }
}

async function initLogo() {
  const logoImg = document.querySelector('.brand img');
  if (!logoImg) return;
  const cutoutSrc = await cutoutWhiteBackground(logoImg.getAttribute('src'));
  if (cutoutSrc) logoImg.src = cutoutSrc;
}

// The product photos are studio shots on a near-white background. Since
// they're now served from our own origin, we can cut that background out
// in-canvas (no image-editing step needed): any near-white, low-saturation
// pixel becomes transparent, with a short ramp for a soft edge. Pastel
// chair colors are safe because they're checked for saturation, not just
// brightness.
function cutoutWhiteBackground(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      try {
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = frame.data;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const minc = Math.min(r, g, b);
          const maxc = Math.max(r, g, b);
          const spread = maxc - minc;
          if (spread < 18) {
            if (minc >= 244) d[i + 3] = 0;
            else if (minc >= 222) d[i + 3] = Math.round(d[i + 3] * (244 - minc) / 22);
          }
        }
        ctx.putImageData(frame, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        resolve(url);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Every chair has a fixed "home" slot: a small, scattered, never-moving
// position/size. Only the current top 3 matches ever leave their home and
// travel to one of the 3 shared "podium" slots (big, upper-middle, right
// above the control card) — everyone else just sits small at home.
const HOME_X_MIN = 3, HOME_X_MAX = 97, HOME_Y_MIN = 3, HOME_Y_MAX = 92;
const HOME_MIN_SIZE = 46, HOME_MAX_SIZE = 100;

const PODIUM_SLOTS = [
  { x: 50, y: 63, size: 250 }, // #1 — biggest, centered right above the control card
  { x: 36, y: 24, size: 190 }, // #2 — upper left
  { x: 64, y: 24, size: 190 }, // #3 — upper right
];

// Ranks 4–11 (the next 8 best matches) get a "medium" tier: 4 chairs
// flanking the podium on the left, 4 on the right, each noticeably bigger
// than the outer scatter but well below podium size.
const MEDIUM_SLOTS = [
  { x: 15, y: 13, size: 130 },
  { x: 11, y: 37, size: 130 },
  { x: 12, y: 61, size: 130 },
  { x: 16, y: 83, size: 130 },
  { x: 85, y: 13, size: 130 },
  { x: 89, y: 37, size: 130 },
  { x: 88, y: 61, size: 130 },
  { x: 84, y: 83, size: 130 },
];

// The podium/medium slots always sit in the same screen spot (only which
// chair occupies them changes), so home slots must permanently steer clear
// of that space — otherwise a small "resting" chair visually collides with
// whichever chair currently occupies that slot.
// One zone covers the whole triangular area the 3 podium slots span
// together (not 3 separate small zones) — otherwise chairs land in the
// gaps between the slots and still visually read as "inside the cluster".
const PODIUM_EXCLUSION_ZONES = [
  { cx: 50, cy: 42, rx: 32, ry: 38 },
  { cx: 50, cy: 90, rx: 22, ry: 16 }, // the floating control card itself
  { cx: 50, cy: 6, rx: 20, ry: 9 },   // the logo header
  ...MEDIUM_SLOTS.map((s) => ({ cx: s.x, cy: s.y, rx: 8, ry: 9 })),
];

function keepOutsidePodiumZones(x, y) {
  // Several passes: pushing out of one zone can land inside a neighboring
  // one when zones are packed close together (e.g. the medium-tier column).
  for (let pass = 0; pass < 4; pass++) {
    for (const z of PODIUM_EXCLUSION_ZONES) {
      const dx = x - z.cx, dy = y - z.cy;
      const nx = dx / z.rx, ny = dy / z.ry;
      const dist = Math.sqrt(nx * nx + ny * ny);
      if (dist < 1) {
        const angle = Math.atan2(dy || (Math.random() - 0.5), dx || (Math.random() - 0.5));
        x = z.cx + Math.cos(angle) * z.rx * 1.3;
        y = z.cy + Math.sin(angle) * z.ry * 1.3;
      }
    }
  }
  // A generous, mostly-cosmetic bound only — NOT the tight home-slot canvas
  // bounds, since re-clamping to those would undo an escape push that
  // legitimately needs to land near/past the visible edge (e.g. escaping
  // the header zone upward, toward the top of the page).
  return { x: clamp(x, -8, 108), y: clamp(y, -8, 108) };
}

async function buildStage() {
  const cols = 6;
  const rows = Math.ceil(chairs.length / cols);
  const colW = (HOME_X_MAX - HOME_X_MIN) / cols;
  const rowH = (HOME_Y_MAX - HOME_Y_MIN) / rows;
  const order = seededShuffle(chairs.map((c, i) => i), mulberry32(42));

  items = await Promise.all(chairs.map(async (chair, idx) => {
    const rand = mulberry32(seedFromString(chair.id));
    const slot = order.indexOf(idx);
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    const rawX = clamp(HOME_X_MIN + colW * (col + 0.5) + (rand() - 0.5) * colW * 0.8, HOME_X_MIN, HOME_X_MAX);
    const rawY = clamp(HOME_Y_MIN + rowH * (row + 0.5) + (rand() - 0.5) * rowH * 0.8, HOME_Y_MIN, HOME_Y_MAX);
    const { x: homeX, y: homeY } = keepOutsidePodiumZones(rawX, rawY);
    const homeSize = HOME_MIN_SIZE + rand() * (HOME_MAX_SIZE - HOME_MIN_SIZE);

    const el = document.createElement('div');
    el.className = 'chair-item';
    el.style.left = homeX + '%';
    el.style.top = homeY + '%';
    el.style.width = homeSize + 'px';

    const cutoutSrc = await cutoutWhiteBackground(chair.image);

    const img = document.createElement('img');
    img.src = cutoutSrc || chair.image;
    img.alt = chair.name;
    img.onerror = () => el.remove();
    el.appendChild(img);

    el.addEventListener('mouseenter', (e) => showTooltip(e, chair));
    el.addEventListener('mousemove', (e) => positionTooltip(e));
    el.addEventListener('mouseleave', hideTooltip);
    el.addEventListener('click', () => window.open(chair.productUrl, '_blank', 'noopener'));

    stage.appendChild(el);

    return { chair, el, homeX, homeY, homeSize };
  }));
}

function matchScore(hours, min, max) {
  if (hours >= min && hours <= max) return 1;
  const dist = hours < min ? min - hours : hours - max;
  return Math.max(0, 1 - dist / 3);
}

function applyFilter() {
  const hours = Number(slider.value);
  hoursLabel.textContent = hours + ' שעות ביום';

  // Rank by score desc, then by closeness to the middle of the chair's own
  // range (keeps a stable single winner instead of ties), then by price.
  items.forEach((item) => {
    const { min, max } = item.chair.sittingTime;
    item.score = matchScore(hours, min, max);
    item.distToMid = Math.abs(hours - (min + max) / 2);
  });
  const sorted = items.slice().sort((a, b) =>
    (b.score - a.score) || (a.distToMid - b.distToMid) || (a.chair.price - b.chair.price)
  );

  sorted.forEach((item, rank) => {
    const { el, homeX, homeY, homeSize } = item;
    if (rank < 3) {
      const slot = PODIUM_SLOTS[rank];
      el.style.left = slot.x + '%';
      el.style.top = slot.y + '%';
      el.style.width = slot.size + 'px';
      el.style.zIndex = String(200 - rank);
    } else if (rank < 11) {
      const slot = MEDIUM_SLOTS[rank - 3];
      el.style.left = slot.x + '%';
      el.style.top = slot.y + '%';
      el.style.width = slot.size + 'px';
      el.style.zIndex = String(100 - rank);
    } else {
      el.style.left = homeX + '%';
      el.style.top = homeY + '%';
      el.style.width = homeSize + 'px';
      el.style.zIndex = '1';
    }
  });
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function showTooltip(e, chair) {
  tooltip.textContent = `${chair.name} · ${chair.price.toLocaleString('he-IL')} ₪`;
  tooltip.hidden = false;
  positionTooltip(e);
}

function positionTooltip(e) {
  tooltip.style.left = e.clientX + 'px';
  tooltip.style.top = e.clientY + 'px';
}

function hideTooltip() {
  tooltip.hidden = true;
}

slider.addEventListener('input', applyFilter);
loadChairs();
initLogo();
