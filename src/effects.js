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
const AFRO_COLOR   = "#17120d";              // near-black brown
const AFRO_HILIGHT = "rgba(120, 92, 60, 0.30)"; // curl sheen
const AFRO_SIZE    = 1.15;   // base radius as a multiple of face width
const AFRO_LIFT    = 0.78;   // how far the mass sits above the forehead (× base radius)
const AFRO_BUMPS   = 20;     // edge puffs → fluffy silhouette

// Stable curl-texture points in a unit disk (seeded once so they don't shimmer)
const AFRO_CURLS = Array.from({ length: 60 }, () => {
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()); // uniform over disk area
  return [Math.cos(a) * r, Math.sin(a) * r];
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

// ---------------------------------------------------------------------------
//  SKELETON  (uses PoseLandmarker results)
// ---------------------------------------------------------------------------
export function drawSkeleton(ctx, drawingUtils, result, deps) {
  if (!result?.landmarks?.length) return false;
  const { PoseLandmarker } = deps;

  const landmarks = mostProminentPose(result.landmarks);

  // Glow pass: thick, low-alpha line underneath for a soft neon halo
  ctx.save();
  ctx.shadowColor = SKELETON_COLOR;
  ctx.shadowBlur = 18;
  drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
    color: SKELETON_COLOR,
    lineWidth: 5,
  });
  ctx.restore();

  // Joints
  drawingUtils.drawLandmarks(landmarks, {
    color: JOINT_COLOR,
    fillColor: SKELETON_COLOR,
    lineWidth: 2,
    radius: 4,
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
//  AFRO  — procedural afro wig anchored to each detected head.
//  Sized to the face width, tilted with head rotation, drawn as a fluffy
//  bumpy silhouette with stable curl texture. Works on multiple heads.
// ---------------------------------------------------------------------------
export function drawAfro(ctx, drawingUtils, result, deps) {
  if (!result?.faceLandmarks?.length) return false;
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const px = (lms, i) => [lms[i].x * w, lms[i].y * h];

  for (const lms of result.faceLandmarks) {
    const [rx, ry] = px(lms, 234);  // right cheek edge
    const [lx, ly] = px(lms, 454);  // left cheek edge
    const [fx, fy] = px(lms, 10);   // forehead top (mid)
    const [e1x, e1y] = px(lms, 33);  // right eye outer corner
    const [e2x, e2y] = px(lms, 263); // left eye outer corner

    const fw = Math.hypot(lx - rx, ly - ry);
    if (!(fw > 0)) continue;

    const baseR = fw * AFRO_SIZE;
    const lift  = baseR * AFRO_LIFT;
    const bumpR = baseR * 0.5;

    const cx = (rx + lx) / 2;       // horizontal centre of the face
    const cy = fy;                  // anchor at forehead top
    const angle = Math.atan2(e2y - e1y, e2x - e1x); // head tilt

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // Fluffy silhouette: one big disk + a ring of overlapping puffs.
    // Centre is lifted up so the mass crowns the head and clears the eyes.
    ctx.shadowColor = "rgba(0,0,0,0.40)";
    ctx.shadowBlur = baseR * 0.22;
    ctx.fillStyle = AFRO_COLOR;
    ctx.beginPath();
    ctx.moveTo(baseR, -lift);
    ctx.arc(0, -lift, baseR, 0, Math.PI * 2);
    for (let i = 0; i < AFRO_BUMPS; i++) {
      const a = (i / AFRO_BUMPS) * Math.PI * 2;
      const bx = Math.cos(a) * baseR;
      const by = -lift + Math.sin(a) * baseR;
      ctx.moveTo(bx + bumpR, by);
      ctx.arc(bx, by, bumpR, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.shadowColor = "transparent";

    // Curl texture — lighter dabs, clipped to the main disk so they stay inside
    ctx.beginPath();
    ctx.arc(0, -lift, baseR, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = AFRO_HILIGHT;
    const curlR = bumpR * 0.38;
    for (const [ux, uy] of AFRO_CURLS) {
      ctx.beginPath();
      ctx.arc(ux * baseR, -lift + uy * baseR, curlR, 0, Math.PI * 2);
      ctx.fill();
    }

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
  voronoi:  { label: "VORONOI",    detector: "face", draw: drawVoronoi  },
  afro:     { label: "AFRO",       detector: "face", draw: drawAfro     },
};
