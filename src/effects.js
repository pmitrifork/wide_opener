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

// MediaPipe FaceLandmarker face-oval ring (ordered: top centre, around to chin
// and back up). Used to trace the real head outline.
const FACE_OVAL_IDX = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
  162, 21, 54, 103, 67, 109,
];

// Stable per-vertex frizz offsets for the outline (seeded once, no shimmer)
const AFRO_FRIZZ_SEED = FACE_OVAL_IDX.map(() => Math.random() * 2 - 1);

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
//  Registry. Each effect declares which detector it needs ('pose' | 'face' | 'both').
// ---------------------------------------------------------------------------
export const EFFECTS = {
  skeleton: { label: "SKELETON",   detector: "pose", draw: drawSkeleton },
  mesh:     { label: "FACE MESH",  detector: "face", draw: drawMesh     },
  fullbody: { label: "FULL BODY",  detector: "both", draw: drawFullBody },
  voronoi:  { label: "VORONOI",    detector: "face", draw: drawVoronoi  },
  afro:     { label: "AFRO",       detector: "face", draw: drawAfro     },
};
