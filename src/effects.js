// ============================================================================
//  EFFECTS  —  how detected landmarks get turned into visuals
//  Add a new effect by writing a draw function and registering it in EFFECTS.
// ============================================================================

// Palette (kept here so the whole look is tweakable in one place)
const SKELETON_COLOR = "#39ffd0"; // electric mint — reads well on dark screens
const JOINT_COLOR    = "#ffffff";
const MESH_COLOR      = "rgba(255, 255, 255, 0.55)";
const MESH_EYE_COLOR  = "rgba(57, 255, 208, 0.9)";

// --- Voronoi "Wide Open" shell --------------------------------------------
const VORONOI_BASE   = "#cfc6b4";  // shadowed cream (strut underside)
const VORONOI_TOP    = "#f7f2e7";  // bright cream (strut highlight)
const VORONOI_STEP   = 4;          // sample every Nth landmark → bigger cells (higher = chunkier)
const VORONOI_WIDTH  = 9;          // strut thickness in px (scaled by face size below)
const VORONOI_EXPAND = 1.06;       // grow the clip region outward so cells fill the whole face

// --- Afro wig overlay ------------------------------------------------------
// The outline is built from the real FACE_OVAL landmarks (so it follows the
// detected head shape + tilt), expanded outward into a hair dome. Texture is
// drawn as many thin radial hair strokes rather than circles.
const AFRO_BASE    = "#171009";   // base hair fill
const AFRO_STRANDS = ["#0c0805", "#241a10", "#3a2a18", "#5a4126"]; // strand tones, dark→light
const AFRO_VOL     = 0.55;   // outward expansion of the whole outline (× radius)
const AFRO_TOPVOL  = 0.85;   // extra expansion at the top (taller crown)
const AFRO_FRIZZ   = 0.05;   // random edge jaggedness (× face width)
const AFRO_HOLE_W  = 0.46;   // face opening half-width  (× face width)
const AFRO_HOLE_H  = 0.52;   // face opening half-height (× face height)
const AFRO_HOLE_CY = 0.10;   // face opening vertical nudge down (× face height)
const AFRO_JAW     = 0.46;   // clip the hair off below this line (× face height)

// Optional real afro image overlay. Drop a transparent PNG at ./drawAfro.png
// and it will be used instead of the procedural hair (falls back if absent).
//   AFRO_IMG_SCALE : image width as a multiple of detected face width
//   AFRO_IMG_CY    : vertical centre offset from face centre (× face height;
//                    negative = up). Tune so the face sits in the wig opening.
const AFRO_IMG_SCALE = 2.1;
const AFRO_IMG_CY    = -0.45;
const afroImg = new Image();
let afroImgReady = false;
afroImg.onload = () => { afroImgReady = afroImg.naturalWidth > 0; };
afroImg.src = "./drawAfro.png";

// Devil horns overlay (devil.png). The source has horns up top and small eye
// ovals near the bottom — we crop to the top portion to keep only the horns.
//   DEVIL_SCALE : horn span as a multiple of face width
//   DEVIL_CY    : horn base position relative to forehead (× face height, +down)
//   DEVIL_CROP  : fraction of source height to keep (top = horns, excludes eyes)
const DEVIL_SCALE = 1.7;
const DEVIL_CY    = -0.28;  // horn base position relative to forehead (× face height; negative = higher)
const DEVIL_CROP  = 0.52;
const DEVIL_TILT  = 45;     // each horn splayed outward by this many degrees
const DEVIL_GAP   = 0.02;   // horizontal gap of each horn base from centre (× face width)
const devilImg = new Image();
let devilImgReady = false;
devilImg.onload = () => { devilImgReady = devilImg.naturalWidth > 0; };
devilImg.src = "./devil.png";

// Cowboy hat overlay (black-cowboy-hat.png)
//   HAT_SCALE : hat width as a multiple of face width (brim is wide)
//   HAT_CY    : hat bottom relative to forehead (× face height, +down)
const HAT_SCALE = 2.05;
const HAT_CY    = 0.18;
const hatImg = new Image();
let hatImgReady = false;
hatImg.onload = () => { hatImgReady = hatImg.naturalWidth > 0; };
hatImg.src = "./black-cowboy-hat.png";

// --- Halo / aureola (procedural golden glowing ring) -----------------------
const HALO_RX    = 0.62;   // ring radius (× face width)
const HALO_FLAT  = 0.30;   // vertical squash for perspective (ry / rx)
const HALO_CY    = -0.85;  // height above the forehead (× face height; negative = up)
const HALO_GLOW  = "rgba(255, 196, 64, 0.9)";  // outer glow colour
const HALO_GOLD  = "#ffcb47";                  // ring gold
const HALO_CORE  = "#fff6d6";                  // bright core
// Stable sparkle positions around the ring (angle, radial jitter, size)
const HALO_SPARKLES = Array.from({ length: 14 }, () => [
  Math.random() * Math.PI * 2, 0.85 + Math.random() * 0.3, 0.4 + Math.random() * 0.8,
]);

// MediaPipe FaceLandmarker face-oval ring (ordered: top centre, around to chin
// and back up). Used to trace the real head outline.
const FACE_OVAL_IDX = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
  162, 21, 54, 103, 67, 109,
];

// Stable per-vertex frizz offsets for the outline (seeded once, no shimmer)
const AFRO_FRIZZ_SEED = FACE_OVAL_IDX.map(() => Math.random() * 2 - 1);

// Build a Path2D of the face-oval region (optionally expanded outward from its
// centroid). Used to reveal the live face when the background is replaced.
export function faceRegionPath(lms, w, h, expand = 1.12) {
  let cx = 0, cy = 0;
  const pts = FACE_OVAL_IDX.map((idx) => {
    const x = lms[idx].x * w, y = lms[idx].y * h;
    cx += x; cy += y;
    return [x, y];
  });
  cx /= pts.length; cy /= pts.length;
  const path = new Path2D();
  pts.forEach(([x, y], i) => {
    const ex = cx + (x - cx) * expand, ey = cy + (y - cy) * expand;
    i ? path.lineTo(ex, ey) : path.moveTo(ex, ey);
  });
  path.closePath();
  return path;
}

// Stable hair strands: unit-disk anchor, length, sideways curve, tone index.
const AFRO_STROKES = Array.from({ length: 900 }, () => {
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random());
  return {
    x: Math.cos(a) * r,
    y: Math.sin(a) * r,
    len: 0.06 + Math.random() * 0.10,        // × radius
    curve: (Math.random() - 0.5) * 0.5,      // sideways kink
    tone: (Math.random() * AFRO_STRANDS.length) | 0,
    width: 0.8 + Math.random() * 1.4,
  };
});

// d3-delaunay is loaded lazily from CDN as an ES module so the other effects
// keep working even if it's unavailable (e.g. fully offline mode).
let Delaunay = null;
let delaunayLoading = null;
function ensureDelaunay() {
  if (Delaunay || delaunayLoading) return;
  delaunayLoading = import("https://cdn.jsdelivr.net/npm/d3-delaunay@6/+esm")
    .then((m) => { Delaunay = m.Delaunay; })
    .catch((e) => { console.error("d3-delaunay load failed:", e); });
}

// PoseLandmarker indices 0–10 are face points (nose, eyes, ears, mouth).
// Body starts at index 11 (left shoulder).
const BODY_START = 11;
const bodyOnly = (connections) =>
  connections.filter(({ start, end }) => start >= BODY_START && end >= BODY_START);

// Pick the pose whose landmarks have the highest average visibility score.
// This reliably selects the most centred / most fully visible person and
// avoids the jittery multi-skeleton look when bystanders drift into frame.
function mostProminentPose(landmarkGroups) {
  let best = null, bestScore = -1;
  for (const group of landmarkGroups) {
    const score = group.reduce((s, lm) => s + (lm.visibility ?? 0), 0) / group.length;
    if (score > bestScore) { bestScore = score; best = group; }
  }
  return best;
}

// Per-person skeleton colours (cycled when multiple people are detected)
const SKELETON_COLORS = ["#39ffd0", "#ff5bd0", "#ffd83b", "#5b9dff", "#a6ff5b"];

// ---------------------------------------------------------------------------
//  SKELETON  (uses PoseLandmarker results) — draws every detected person
// ---------------------------------------------------------------------------
export function drawSkeleton(ctx, drawingUtils, result, deps) {
  if (!result?.landmarks?.length) return false;
  const { PoseLandmarker } = deps;

  result.landmarks.forEach((landmarks, i) => {
    const color = SKELETON_COLORS[i % SKELETON_COLORS.length];

    // Glow pass: thick line with a soft neon halo
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
      color,
      lineWidth: 5,
    });
    ctx.restore();

    // Joints
    drawingUtils.drawLandmarks(landmarks, {
      color: JOINT_COLOR,
      fillColor: color,
      lineWidth: 2,
      radius: 4,
    });
  });

  return true;
}

// ---------------------------------------------------------------------------
//  MESH  (uses FaceLandmarker results — the classic dense white AR mesh)
// ---------------------------------------------------------------------------
export function drawMesh(ctx, drawingUtils, result, deps) {
  if (!result?.faceLandmarks?.length) return false;
  const { FaceLandmarker } = deps;

  for (const landmarks of result.faceLandmarks) {
    drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
      color: MESH_COLOR,
      lineWidth: 0.6,
    });
    // A couple of accent features so the face reads clearly
    drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,  { color: MESH_EYE_COLOR, lineWidth: 1.5 });
    drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,   { color: MESH_EYE_COLOR, lineWidth: 1.5 });
    drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,  { color: MESH_EYE_COLOR, lineWidth: 1.5 });
    drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS,       { color: MESH_EYE_COLOR, lineWidth: 1.5 });
  }
  return true;
}

// ---------------------------------------------------------------------------
//  FULL BODY  (pose skeleton for the body + face mesh for the head)
//  result is { pose, face } — either may be null if not yet detected.
// ---------------------------------------------------------------------------
export function drawFullBody(ctx, drawingUtils, { pose, face }, deps) {
  const { PoseLandmarker, FaceLandmarker } = deps;
  let drew = false;

  if (pose?.landmarks?.length) {
    const landmarks = mostProminentPose(pose.landmarks);

    // Body skeleton only — face connections stripped so the mesh handles the head
    ctx.save();
    ctx.shadowColor = SKELETON_COLOR;
    ctx.shadowBlur  = 18;
    drawingUtils.drawConnectors(landmarks, bodyOnly(PoseLandmarker.POSE_CONNECTIONS), {
      color: SKELETON_COLOR, lineWidth: 5,
    });
    ctx.restore();
    // Body joints only (no face dots — the mesh covers the head)
    drawingUtils.drawLandmarks(landmarks.slice(BODY_START), {
      color: JOINT_COLOR, fillColor: SKELETON_COLOR, lineWidth: 2, radius: 4,
    });
    drew = true;
  }

  if (face?.faceLandmarks?.length) {
    // Tessellation only — no eye/lip accents, the pose skeleton already
    // covers the face region and the accents would clash with it.
    const landmarks = face.faceLandmarks[0];
    drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
      color: MESH_COLOR, lineWidth: 0.6,
    });
    drew = true;
  }

  return drew;
}

// ---------------------------------------------------------------------------
//  VORONOI  — "Wide Open" style 3D-printed organic shell over the face.
//  Builds a Voronoi diagram from a decimated subset of the face landmarks,
//  clips it to the face hull, and renders thick rounded cream struts with a
//  drop-shadow + centre-highlight to fake a 3D-printed tube cross-section.
// ---------------------------------------------------------------------------
export function drawVoronoi(ctx, drawingUtils, result, deps) {
  if (!result?.faceLandmarks?.length) return false;

  // While the library streams in, fall back to the plain mesh so it's not blank
  if (!Delaunay) {
    ensureDelaunay();
    return drawMesh(ctx, drawingUtils, result, deps);
  }

  const w = ctx.canvas.width, h = ctx.canvas.height;
  const lms = result.faceLandmarks[0];

  // Decimate the 468 points to pixel coords — fewer points = larger cells.
  // MediaPipe's index ordering is non-uniform spatially, so striding gives a
  // pleasantly irregular (organic) sample.
  const pts = [];
  for (let i = 0; i < lms.length; i += VORONOI_STEP) {
    pts.push([lms[i].x * w, lms[i].y * h]);
  }
  if (pts.length < 3) return false;

  const delaunay = Delaunay.from(pts);
  const voronoi  = delaunay.voronoi([0, 0, w, h]);

  // Scale strut width to the face size so it looks right at any distance
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const faceSpan = Math.max(maxX - minX, maxY - minY);
  const strutW   = Math.max(2, (VORONOI_WIDTH / 400) * faceSpan);

  ctx.save();

  // Clip to the (expanded) convex hull of the face points. The raw hull passes
  // through the outermost landmark centres, leaving the face edge unfilled, so
  // we push each hull vertex outward from the centroid to cover the whole face.
  const hull = delaunay.hull;
  let cx = 0, cy = 0;
  for (const idx of hull) { cx += pts[idx][0]; cy += pts[idx][1]; }
  cx /= hull.length; cy /= hull.length;

  // Build the expanded boundary polygon once; reused for both clip and outline.
  // NB: delaunay.hull is a Uint32Array, so use Array.from (typed-array .map
  // would coerce the returned [x,y] pairs back to numbers).
  const boundary = Array.from(hull, (idx) => {
    const [x, y] = pts[idx];
    return [cx + (x - cx) * VORONOI_EXPAND, cy + (y - cy) * VORONOI_EXPAND];
  });
  const traceBoundary = () => {
    ctx.beginPath();
    boundary.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };

  // --- interior cells, clipped to the boundary ---
  ctx.save();
  traceBoundary();
  ctx.clip();

  // One path containing every cell edge (each interior edge drawn once)
  ctx.beginPath();
  voronoi.render(ctx);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Base pass — wide, shadowed cream, with a drop-shadow for printed depth
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = strutW * 0.8;
  ctx.shadowOffsetX = strutW * 0.25;
  ctx.shadowOffsetY = strutW * 0.35;
  ctx.strokeStyle = VORONOI_BASE;
  ctx.lineWidth = strutW;
  ctx.stroke();

  // Highlight pass — narrower bright cream down the centre → tube roundness
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = VORONOI_TOP;
  ctx.lineWidth = strutW * 0.45;
  ctx.stroke();

  ctx.restore(); // drop the clip so the full boundary strut width shows

  // --- boundary outline — a slightly thicker rounded frame around the shell ---
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  traceBoundary();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = strutW;
  ctx.shadowOffsetX = strutW * 0.25;
  ctx.shadowOffsetY = strutW * 0.35;
  ctx.strokeStyle = VORONOI_BASE;
  ctx.lineWidth = strutW * 1.35;
  ctx.stroke();

  traceBoundary();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = VORONOI_TOP;
  ctx.lineWidth = strutW * 0.6;
  ctx.stroke();

  ctx.restore();
  return true;
}

// ---------------------------------------------------------------------------
//  BODY MESH  — "Wide Open" Voronoi shell applied to the whole body, using the
//  PoseLandmarker person-segmentation mask as the silhouette.
//  buildBodyMesh() is called at detection time (consumes the mask immediately
//  and renders to an offscreen canvas); drawBodyMesh() just blits that canvas.
// ---------------------------------------------------------------------------
let _bodyCanvas = null;      // offscreen: the finished masked mesh
let _maskCanvas = null;      // offscreen: silhouette alpha
let _outlineCanvas = null;   // offscreen: silhouette boundary ring
let _bodyReady  = false;
let _bodyBox = null;         // smoothed body bounding box (mask px), for stable motion

// Deterministic per-cell jitter (stable across frames → no shimmer)
function _hash(a, b) {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// Seeded points in the body's normalised [0,1]×[0,1] frame, with extra density
// near the top (head) and bottom (feet/hands) to mimic the reference. They get
// Lloyd-relaxed once (when d3 is ready) into organic, evenly-spaced cells, then
// mapped onto the live body box each frame so the pattern moves with the person.
let _seed = 1337;
function _rand() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
function _band(n, v0, v1) {
  const out = [];
  for (let i = 0; i < n; i++) out.push([_rand(), v0 + _rand() * (v1 - v0)]);
  return out;
}
let BODY_POINTS = [
  ..._band(250, 0.10, 0.90),  // torso / limbs — uniform
  ..._band(70,  0.00, 0.13),  // head — dense
  ..._band(55,  0.85, 1.00),  // feet / lower legs — dense
];
let _relaxed = false;

// Lloyd relaxation: move each point to its Voronoi cell centroid (organic spacing)
function _lloyd(points, iters) {
  let pts = points.map((p) => [Math.min(1, Math.max(0, p[0])), Math.min(1, Math.max(0, p[1]))]);
  for (let it = 0; it < iters; it++) {
    const v = Delaunay.from(pts).voronoi([0, 0, 1, 1]);
    pts = pts.map((p, i) => {
      const cell = v.cellPolygon(i);
      if (!cell) return p;
      let a = 0, cx = 0, cy = 0;
      for (let j = 0; j < cell.length - 1; j++) {
        const [x0, y0] = cell[j], [x1, y1] = cell[j + 1];
        const cr = x0 * y1 - x1 * y0;
        a += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr;
      }
      a *= 0.5;
      if (Math.abs(a) < 1e-9) return p;
      return [cx / (6 * a), cy / (6 * a)];
    });
  }
  return pts;
}

export function buildBodyMesh(mask, outW, outH) {
  _bodyReady = false;
  if (!Delaunay) { ensureDelaunay(); return; }

  // One-time organic relaxation of the seeded points (needs d3)
  if (!_relaxed) { BODY_POINTS = _lloyd(BODY_POINTS, 2); _relaxed = true; }

  const mw = mask.width, mh = mask.height;
  let data;
  try { data = mask.getAsFloat32Array(); } catch (e) { return; }
  if (!data) return;

  if (!_bodyCanvas) _bodyCanvas = document.createElement("canvas");
  if (!_maskCanvas) _maskCanvas = document.createElement("canvas");
  _bodyCanvas.width = outW; _bodyCanvas.height = outH;
  _maskCanvas.width = mw;   _maskCanvas.height = mh;

  // Silhouette → alpha mask canvas
  const mctx = _maskCanvas.getContext("2d");
  const id = mctx.createImageData(mw, mh);
  for (let i = 0; i < mw * mh; i++) {
    const inside = data[i] > 0.5 ? 255 : 0;
    id.data[i * 4] = 255; id.data[i * 4 + 1] = 255; id.data[i * 4 + 2] = 255;
    id.data[i * 4 + 3] = inside;
  }
  mctx.putImageData(id, 0, 0);

  // Body bounding box from the silhouette (mask px), smoothed across frames
  // so boundary noise doesn't make the pattern shake.
  let minX = mw, minY = mh, maxX = 0, maxY = 0, any = false;
  for (let my = 0; my < mh; my++) {
    for (let mx = 0; mx < mw; mx++) {
      if (data[my * mw + mx] > 0.5) {
        any = true;
        if (mx < minX) minX = mx; if (mx > maxX) maxX = mx;
        if (my < minY) minY = my; if (my > maxY) maxY = my;
      }
    }
  }
  const octx = _bodyCanvas.getContext("2d");
  octx.clearRect(0, 0, outW, outH);
  if (!any || maxX - minX < 4 || maxY - minY < 4) { _bodyBox = null; return; }

  const raw = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  if (!_bodyBox) _bodyBox = raw;
  else {
    const a = 0.35; // EMA: smooth box motion
    _bodyBox = {
      x: a * raw.x + (1 - a) * _bodyBox.x,
      y: a * raw.y + (1 - a) * _bodyBox.y,
      w: a * raw.w + (1 - a) * _bodyBox.w,
      h: a * raw.h + (1 - a) * _bodyBox.h,
    };
  }
  const bb = _bodyBox;

  // Map the fixed normalised points onto the live (smoothed) body box, then to
  // output pixels. Constant point count → pattern moves with the body, no pops.
  const sx = outW / mw, sy = outH / mh;
  const pts = BODY_POINTS.map(([u, v]) => [
    (bb.x + u * bb.w) * sx,
    (bb.y + v * bb.h) * sy,
  ]);
  if (pts.length < 4) return;

  const delaunay = Delaunay.from(pts);
  const voronoi = delaunay.voronoi([0, 0, outW, outH]);

  // Build the cell-edge path once, stroke it in three passes for a 3D printed
  // tube look: wide dark base (shadow) → cream body → bright core highlight.
  octx.beginPath();
  voronoi.render(octx);
  octx.lineCap = "round";
  octx.lineJoin = "round";
  const strut = Math.max(3, outW * 0.0075);

  // 1) dark underside + drop shadow → depth
  octx.shadowColor = "rgba(0,0,0,0.5)";
  octx.shadowBlur = strut * 1.1;
  octx.shadowOffsetX = strut * 0.3;
  octx.shadowOffsetY = strut * 0.4;
  octx.strokeStyle = "#9a8f78";
  octx.lineWidth = strut;
  octx.stroke();

  // 2) cream body of the tube
  octx.shadowColor = "transparent";
  octx.strokeStyle = VORONOI_BASE;
  octx.lineWidth = strut * 0.7;
  octx.stroke();

  // 3) bright core highlight down the centre → rounded tube
  octx.strokeStyle = VORONOI_TOP;
  octx.lineWidth = strut * 0.3;
  octx.stroke();

  // Crop the struts to the body silhouette
  octx.globalCompositeOperation = "destination-in";
  octx.drawImage(_maskCanvas, 0, 0, outW, outH);
  octx.globalCompositeOperation = "source-over";

  // Silhouette boundary: dilate the mask (offset copies) then subtract the
  // original → a ring hugging the body edge, tinted cream.
  if (!_outlineCanvas) _outlineCanvas = document.createElement("canvas");
  _outlineCanvas.width = outW; _outlineCanvas.height = outH;
  const lc = _outlineCanvas.getContext("2d");
  lc.clearRect(0, 0, outW, outH);
  const t = Math.max(3, outW * 0.006);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    lc.drawImage(_maskCanvas, Math.cos(a) * t, Math.sin(a) * t, outW, outH);
  }
  lc.globalCompositeOperation = "source-in";    // tint the dilated shape
  lc.fillStyle = VORONOI_TOP;
  lc.fillRect(0, 0, outW, outH);
  lc.globalCompositeOperation = "destination-out"; // carve out the interior
  lc.drawImage(_maskCanvas, 0, 0, outW, outH);
  lc.globalCompositeOperation = "source-over";

  octx.shadowColor = "rgba(0,0,0,0.4)";
  octx.shadowBlur = strut;
  octx.drawImage(_outlineCanvas, 0, 0);
  octx.shadowColor = "transparent";

  _bodyReady = true;
}

export function drawBodyMesh(ctx) {
  if (!_bodyReady || !_bodyCanvas) return false;
  ctx.drawImage(_bodyCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
  return true;
}

// ---------------------------------------------------------------------------
//  AFRO  — procedural afro anchored to each detected head.
//  The outline is traced from the real FACE_OVAL landmarks and expanded into a
//  hair dome (so it follows the head's actual shape + tilt), with the face
//  punched out. Texture is hundreds of thin radial hair strands, not circles.
// ---------------------------------------------------------------------------
export function drawAfro(ctx, drawingUtils, result, deps) {
  if (!result?.faceLandmarks?.length) return false;
  const w = ctx.canvas.width, h = ctx.canvas.height;

  for (const lms of result.faceLandmarks) {
    // Work in a face-local frame: translate to face centre + un-rotate by the
    // head tilt, so the maths below is axis-aligned and conforms to the head.
    const e1 = lms[33], e2 = lms[263];       // eye outer corners
    const angle = Math.atan2((e2.y - e1.y) * h, (e2.x - e1.x) * w);
    const cos = Math.cos(angle), sin = Math.sin(angle);

    // Oval points → pixel coords, then into local (centred, unrotated) frame
    const oval = FACE_OVAL_IDX.map((idx) => {
      const px = lms[idx].x * w, py = lms[idx].y * h;
      return [px, py];
    });
    const faceCX = oval.reduce((s, p) => s + p[0], 0) / oval.length;
    const faceCY = oval.reduce((s, p) => s + p[1], 0) / oval.length;
    const local = oval.map(([px, py]) => {
      const dx = px - faceCX, dy = py - faceCY;
      return [cos * dx + sin * dy, -sin * dx + cos * dy]; // rotate by -angle
    });

    // Face metrics in local frame
    let maxX = 0, maxY = 0;
    for (const [x, y] of local) { maxX = Math.max(maxX, Math.abs(x)); maxY = Math.max(maxY, Math.abs(y)); }
    const fw = maxX * 2, fh = maxY * 2;
    if (!(fw > 0) || !(fh > 0)) continue;

    // --- Real image overlay (preferred when ./afro.png is available) ---
    if (afroImgReady) {
      const iw = fw * AFRO_IMG_SCALE;
      const ih = iw * (afroImg.naturalHeight / afroImg.naturalWidth);
      ctx.save();
      ctx.translate(faceCX, faceCY);
      ctx.rotate(angle);
      ctx.drawImage(afroImg, -iw / 2, fh * AFRO_IMG_CY - ih / 2, iw, ih);
      ctx.restore();
      continue;
    }

    // Expanded hair outline: push each oval vertex outward from centre, more
    // at the top (taller crown), plus a stable frizz wobble.
    const outline = local.map(([x, y], i) => {
      const topness = Math.max(0, -y / maxY);             // 1 at top, 0 below
      const f = 1 + AFRO_VOL + AFRO_TOPVOL * topness;
      const frizz = AFRO_FRIZZ_SEED[i] * AFRO_FRIZZ * fw;
      const len = Math.hypot(x, y) || 1;
      return [x * f + (x / len) * frizz, y * f + (y / len) * frizz];
    });

    const dome = new Path2D();
    outline.forEach(([x, y], i) => (i ? dome.lineTo(x, y) : dome.moveTo(x, y)));
    dome.closePath();

    // Face opening (real-ish: an oval over eyes→chin), excluded from the hair
    const hole = new Path2D();
    hole.ellipse(0, fh * AFRO_HOLE_CY, fw * AFRO_HOLE_W, fh * AFRO_HOLE_H, 0, 0, Math.PI * 2);
    dome.addPath(hole);

    ctx.save();
    ctx.translate(faceCX, faceCY);
    ctx.rotate(angle);

    // Clip off everything below the jaw (bare neck, open bottom)
    const jawY = fh * AFRO_JAW;
    ctx.beginPath();
    ctx.rect(-fw * 2, -fh * 3, fw * 4, fh * 3 + jawY);
    ctx.clip();

    // Solid base mass with a soft drop-shadow for depth
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = fw * 0.10;
    ctx.fillStyle = AFRO_BASE;
    ctx.fill(dome, "evenodd");
    ctx.shadowColor = "transparent";

    // Hair strands — thin curved strokes radiating outward from the scalp,
    // clipped to the hair region so they never cross the face.
    ctx.clip(dome, "evenodd");
    ctx.lineCap = "round";
    const reach = Math.max(maxX, maxY) * (1 + AFRO_VOL + AFRO_TOPVOL);
    const scalpY = -fh * 0.15; // strands grow outward from here
    for (const s of AFRO_STROKES) {
      const ax = s.x * reach;
      const ay = scalpY + s.y * reach;
      // outward direction from scalp centre
      const dx = ax, dy = ay - scalpY;
      const d = Math.hypot(dx, dy) || 1;
      const ox = dx / d, oy = dy / d;          // outward unit
      const px2 = -oy, py2 = ox;               // perpendicular (for the kink)
      const L = s.len * reach;
      const k = s.curve * L;
      ctx.strokeStyle = AFRO_STRANDS[s.tone];
      ctx.lineWidth = s.width;
      ctx.beginPath();
      ctx.moveTo(ax - ox * L * 0.5, ay - oy * L * 0.5);
      ctx.quadraticCurveTo(
        ax + px2 * k, ay + py2 * k,
        ax + ox * L * 0.5, ay + oy * L * 0.5
      );
      ctx.stroke();
    }

    ctx.restore();
  }
  return true;
}

// ---------------------------------------------------------------------------
//  DEVIL  — horn image overlay anchored above each detected forehead.
//  Crops the eyes out of the source and places the horns on the head, scaled
//  to face width and rotated with head tilt.
// ---------------------------------------------------------------------------
export function drawDevil(ctx, drawingUtils, result, deps) {
  if (!result?.faceLandmarks?.length || !devilImgReady) return false;
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const px = (lms, i) => [lms[i].x * w, lms[i].y * h];

  for (const lms of result.faceLandmarks) {
    const [rx, ry] = px(lms, 234);   // right cheek edge
    const [lx, ly] = px(lms, 454);   // left cheek edge
    const [fx, fy] = px(lms, 10);    // forehead top (mid) — horn anchor
    const [chx, chy] = px(lms, 152); // chin bottom
    const [e1x, e1y] = px(lms, 33);  // right eye outer corner
    const [e2x, e2y] = px(lms, 263); // left eye outer corner

    const fw = Math.hypot(lx - rx, ly - ry);
    const fh = Math.hypot(chx - fx, chy - fy);
    if (!(fw > 0)) continue;
    const angle = Math.atan2(e2y - e1y, e2x - e1x);

    // Source crop: top DEVIL_CROP of the image (horns only, eyes excluded)
    const sw = devilImg.naturalWidth;
    const sh = devilImg.naturalHeight * DEVIL_CROP;
    const hw = sw / 2;                 // half-width source (one horn)
    const iw = fw * DEVIL_SCALE;
    const ih = iw * (sh / sw);
    const dhw = iw / 2;                // destination half-width (one horn)

    const baseY = fh * DEVIL_CY;       // where horn bases sit, below forehead
    const gap = fw * DEVIL_GAP;        // each base offset from centre
    const tilt = (DEVIL_TILT * Math.PI) / 180;

    ctx.save();
    ctx.translate(fx, fy);   // origin at forehead
    ctx.rotate(angle);

    // Left horn — pivot at its inner-bottom corner, splay outward (CCW)
    ctx.save();
    ctx.translate(-gap, baseY);
    ctx.rotate(-tilt);
    ctx.drawImage(devilImg, 0, 0, hw, sh, -dhw, -ih, dhw, ih);
    ctx.restore();

    // Right horn — pivot at its inner-bottom corner, splay outward (CW)
    ctx.save();
    ctx.translate(gap, baseY);
    ctx.rotate(tilt);
    ctx.drawImage(devilImg, hw, 0, hw, sh, 0, -ih, dhw, ih);
    ctx.restore();

    ctx.restore();
  }
  return true;
}

// ---------------------------------------------------------------------------
//  HALO  — glowing golden aureola floating above each detected head.
// ---------------------------------------------------------------------------
export function drawHalo(ctx, drawingUtils, result, deps) {
  if (!result?.faceLandmarks?.length) return false;
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const px = (lms, i) => [lms[i].x * w, lms[i].y * h];

  for (const lms of result.faceLandmarks) {
    const [rx, ry] = px(lms, 234);   // right cheek edge
    const [lx, ly] = px(lms, 454);   // left cheek edge
    const [fx, fy] = px(lms, 10);    // forehead top (mid)
    const [chx, chy] = px(lms, 152); // chin bottom
    const [e1x, e1y] = px(lms, 33);  // right eye outer corner
    const [e2x, e2y] = px(lms, 263); // left eye outer corner

    const fw = Math.hypot(lx - rx, ly - ry);
    const fh = Math.hypot(chx - fx, chy - fy);
    if (!(fw > 0)) continue;
    const angle = Math.atan2(e2y - e1y, e2x - e1x);

    const rxr = fw * HALO_RX;
    const ryr = rxr * HALO_FLAT;
    const cyH = fh * HALO_CY;

    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(angle);
    ctx.lineCap = "round";

    // Soft outer glow
    ctx.shadowColor = HALO_GLOW;
    ctx.shadowBlur = rxr * 0.6;
    ctx.strokeStyle = HALO_GOLD;
    ctx.lineWidth = ryr * 0.55;
    ctx.beginPath();
    ctx.ellipse(0, cyH, rxr, ryr, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Mid gold pass (keeps the glow but tightens the ring)
    ctx.shadowBlur = rxr * 0.25;
    ctx.lineWidth = ryr * 0.32;
    ctx.beginPath();
    ctx.ellipse(0, cyH, rxr, ryr, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Bright core line
    ctx.shadowBlur = rxr * 0.12;
    ctx.strokeStyle = HALO_CORE;
    ctx.lineWidth = Math.max(1, ryr * 0.14);
    ctx.beginPath();
    ctx.ellipse(0, cyH, rxr, ryr, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Sparkles around the ring
    ctx.fillStyle = HALO_CORE;
    for (const [a, jr, sz] of HALO_SPARKLES) {
      const sx = Math.cos(a) * rxr * jr;
      const sy = cyH + Math.sin(a) * ryr * jr;
      ctx.shadowBlur = rxr * 0.2;
      ctx.beginPath();
      ctx.arc(sx, sy, sz * (ryr * 0.18), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
  return true;
}

// ---------------------------------------------------------------------------
//  COWBOY  — cowboy-hat image overlay anchored on each detected head.
// ---------------------------------------------------------------------------
export function drawCowboy(ctx, drawingUtils, result, deps) {
  if (!result?.faceLandmarks?.length || !hatImgReady) return false;
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const px = (lms, i) => [lms[i].x * w, lms[i].y * h];

  for (const lms of result.faceLandmarks) {
    const [rx, ry] = px(lms, 234);
    const [lx, ly] = px(lms, 454);
    const [fx, fy] = px(lms, 10);    // forehead — hat anchor
    const [chx, chy] = px(lms, 152);
    const [e1x, e1y] = px(lms, 33);
    const [e2x, e2y] = px(lms, 263);

    const fw = Math.hypot(lx - rx, ly - ry);
    const fh = Math.hypot(chx - fx, chy - fy);
    if (!(fw > 0)) continue;
    const angle = Math.atan2(e2y - e1y, e2x - e1x);

    const iw = fw * HAT_SCALE;
    const ih = iw * (hatImg.naturalHeight / hatImg.naturalWidth);

    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(angle);
    ctx.drawImage(hatImg, -iw / 2, fh * HAT_CY - ih, iw, ih);
    ctx.restore();
  }
  return true;
}

// ---------------------------------------------------------------------------
//  Registry. Each effect declares which detector it needs ('pose' | 'face' | 'both').
// ---------------------------------------------------------------------------
export const EFFECTS = {
  skeleton: { label: "SKELETON",   detector: "pose", draw: drawSkeleton },
  mesh:     { label: "FACE MESH",  detector: "face", draw: drawMesh     },
  fullbody: { label: "FULL BODY",  detector: "both", draw: drawFullBody },
  bodymesh: { label: "BODY MESH",  detector: "pose", draw: drawBodyMesh, usesMask: true },
  afro:     { label: "AFRO",       detector: "face", draw: drawAfro, keepFace: true },
  devil:    { label: "DEVIL",      detector: "face", draw: drawDevil, keepFace: true },
  halo:     { label: "HALO",       detector: "face", draw: drawHalo,  keepFace: true },
  cowboy:   { label: "COWBOY",     detector: "face", draw: drawCowboy, keepFace: true },
};
