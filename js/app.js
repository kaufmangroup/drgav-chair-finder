const stage = document.getElementById('stage');
const slider = document.getElementById('sittingSlider');
const hoursLabel = document.getElementById('hoursLabel');
const tooltip = document.getElementById('chairTooltip');

let chairs = [];
let items = [];
let imageCache = {}; // chair.id -> cutout data URL, loaded once regardless of layout/resize

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

async function init() {
  try {
    const res = await fetch('chairs.json');
    if (!res.ok) throw new Error('bad response');
    const data = await res.json();
    chairs = data.chairs || [];
    await loadAllImages();
    populateWelcomeDecor(chairs);
    buildStage();
    applyFilter();
    revealWelcomeScreen();
  } catch (err) {
    stage.innerHTML = '<p style="text-align:center;padding-top:40vh;color:#999">לא הצלחנו לטעון את קטלוג הכיסאות. נסו לרענן את הדף.</p>';
    revealWelcomeScreen();
  }
}

function revealWelcomeScreen() {
  const loading = document.getElementById('loadingScreen');
  const welcome = document.getElementById('welcomeScreen');
  welcome.hidden = false;
  loading.classList.add('hiding');
  setTimeout(() => { loading.hidden = true; }, 400);
}

async function loadAllImages() {
  await Promise.all(chairs.map(async (chair) => {
    imageCache[chair.id] = await cutoutWhiteBackground(chair.image);
  }));
}

async function initLogo() {
  document.querySelectorAll('.brand img, .welcome-logo, .loading-logo').forEach(async (logoImg) => {
    const cutoutSrc = await cutoutWhiteBackground(logoImg.getAttribute('src'));
    if (cutoutSrc) logoImg.src = cutoutSrc;
  });
}

// Decorative chairs orbiting the top/bottom edges of the welcome screen —
// two concentric rings per edge (inner + outer), each a rigid rotating
// carousel (all its chairs keep the same relative spacing), with the outer
// ring spinning faster than the inner one. The band containers clip
// overflow, so the full 360° rotation underneath never actually shows a
// chair drifting into the text in the middle — only the arc that pokes
// into each band's window is ever visible.
const DECOR_RINGS = [
  { name: 'inner', radiusVh: 15, count: 4, duration: 50 },
  { name: 'outer', radiusVh: 27, count: 5, duration: 22 },
];

function populateWelcomeDecor(sourceChairs) {
  const bands = [
    { container: document.getElementById('decorTop'), anchorTop: '100%' },
    { container: document.getElementById('decorBottom'), anchorTop: '0%' },
  ];
  if (!bands[0].container || !bands[1].container) return;

  let chairIndex = 0;
  bands.forEach(({ container, anchorTop }) => {
    DECOR_RINGS.forEach((ring) => {
      const ringEl = document.createElement('div');
      ringEl.className = `decor-ring decor-ring-${ring.name}`;
      ringEl.style.top = anchorTop;
      ringEl.style.animationDuration = ring.duration + 's';

      for (let i = 0; i < ring.count; i++) {
        const chair = sourceChairs[chairIndex % sourceChairs.length];
        chairIndex++;
        const angle = (360 / ring.count) * i;
        const tilt = Math.sin(chairIndex * 12.9) * 14;

        const el = document.createElement('div');
        el.className = 'decor-chair';
        el.style.transform = `rotate(${angle}deg) translate(0, -${ring.radiusVh}vh) rotate(${-angle + tilt}deg)`;

        const img = document.createElement('img');
        img.src = imageCache[chair.id] || chair.image;
        img.alt = '';
        el.appendChild(img);
        ringEl.appendChild(el);
      }
      container.appendChild(ringEl);
    });
  });
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

// Only a curated shortlist is ever visible at once — everything past that
// is simply hidden, not shrunk into background clutter. Sizes are a
// fraction of the smaller viewport dimension so the layout scales sensibly
// on any screen, then clamped so nothing gets absurdly tiny or huge.
const VISIBLE_COUNT = 15; // 3 podium + 12 ring

function vmin() {
  return Math.min(window.innerWidth, window.innerHeight);
}

function sizeFromFraction(fraction, min, max) {
  return clamp(vmin() * fraction, min, max);
}

// The 3 selected chairs: one dominant, centered chair with two slightly
// smaller ones flanking it just above — kept near the true center of the
// screen (between the logo and the control card), not pushed to one side.
function podiumSlots() {
  return [
    { x: 50, y: 56, size: sizeFromFraction(0.42, 170, 300) },
    { x: 31, y: 39, size: sizeFromFraction(0.30, 120, 220) },
    { x: 69, y: 39, size: sizeFromFraction(0.30, 120, 220) },
  ];
}

// The next 12 best matches sit on a real ring around the podium. The ring
// has two gaps — a wide one at the bottom (control card) and a narrower one
// at the top (logo) — so chairs never fight either for space. Positions
// come from a pixel radius (not a percentage one) so the ring reads as an
// actual circle on screen regardless of viewport aspect ratio.
const RING_ANGLES_DEG = [155, 173, 191, 209, 227, 245, 295, 313, 331, 349, 7, 25];

function ringSlots() {
  const size = sizeFromFraction(0.20, 95, 175);
  const cx = 50, cy = 48; // matches the podium cluster's center
  // Independent x/y radii (each a fraction of ITS OWN viewport dimension,
  // not of vmin) so a tall narrow phone gets a taller ellipse that actually
  // uses the extra vertical room, instead of being capped by the narrow
  // width in both directions.
  const radiusXPx = clamp(window.innerWidth * 0.36, 150, 300);
  const radiusYPx = clamp(window.innerHeight * 0.30, 150, 320);
  return RING_ANGLES_DEG.map((deg) => {
    const rad = (deg * Math.PI) / 180;
    const x = cx + ((Math.cos(rad) * radiusXPx) / window.innerWidth) * 100;
    const y = cy + ((Math.sin(rad) * radiusYPx) / window.innerHeight) * 100;
    return { x, y, size };
  });
}

function buildStage() {
  stage.innerHTML = '';

  items = chairs.map((chair) => {
    const el = document.createElement('div');
    el.className = 'chair-item';

    const img = document.createElement('img');
    img.src = imageCache[chair.id] || chair.image;
    img.alt = chair.name;
    img.onerror = () => el.remove();
    el.appendChild(img);

    el.addEventListener('mouseenter', (e) => showTooltip(e, chair));
    el.addEventListener('mousemove', (e) => positionTooltip(e));
    el.addEventListener('mouseleave', hideTooltip);
    el.addEventListener('click', () => window.open(chair.productUrl, '_blank', 'noopener'));

    stage.appendChild(el);

    return { chair, el };
  });
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

  const podium = podiumSlots();
  const ring = ringSlots();

  sorted.forEach((item, rank) => {
    const { el } = item;
    if (rank < 3) {
      const slot = podium[rank];
      el.hidden = false;
      el.style.left = slot.x + '%';
      el.style.top = slot.y + '%';
      el.style.width = slot.size + 'px';
      el.style.zIndex = String(200 - rank);
    } else if (rank < VISIBLE_COUNT) {
      const slot = ring[rank - 3];
      el.hidden = false;
      el.style.left = slot.x + '%';
      el.style.top = slot.y + '%';
      el.style.width = slot.size + 'px';
      el.style.zIndex = String(100 - rank);
    } else {
      el.hidden = true;
    }
  });
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

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(applyFilter, 200);
});

slider.addEventListener('input', applyFilter);

document.getElementById('startBtn').addEventListener('click', () => {
  const welcome = document.getElementById('welcomeScreen');
  const app = document.getElementById('appScreen');
  welcome.classList.add('hiding');
  app.hidden = false;
  applyFilter(); // sizes/positions depend on the now-visible viewport
  setTimeout(() => { welcome.hidden = true; }, 400);
});

init();
initLogo();
