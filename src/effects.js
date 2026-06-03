// ============================================================================
//  EFFECTS  —  how detected landmarks get turned into visuals
//  Add a new effect by writing a draw function and registering it in EFFECTS.
// ============================================================================

// Palette (kept here so the whole look is tweakable in one place)
const SKELETON_COLOR = "#39ffd0"; // electric mint — reads well on dark screens
const JOINT_COLOR    = "#ffffff";
const MESH_COLOR      = "rgba(255, 255, 255, 0.55)";
const MESH_EYE_COLOR  = "rgba(57, 255, 208, 0.9)";

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

// PoseLandmarker landmark indices 0–10 are face points (nose, eyes, ears,
// mouth corners). They're too coarse for close-up use and look wrong on
// face crops, so we strip them and keep only the body skeleton.
// Body landmarks start at index 11 (left shoulder).
const FACE_LANDMARK_COUNT = 11;

function bodyConnections(PoseLandmarker) {
  return PoseLandmarker.POSE_CONNECTIONS.filter(
    ({ start, end }) => start >= FACE_LANDMARK_COUNT && end >= FACE_LANDMARK_COUNT
  );
}

function bodyLandmarks(landmarks) {
  return landmarks.filter((_, i) => i >= FACE_LANDMARK_COUNT);
}

// ---------------------------------------------------------------------------
//  SKELETON  (uses PoseLandmarker results)
// ---------------------------------------------------------------------------
export function drawSkeleton(ctx, drawingUtils, result, deps) {
  if (!result?.landmarks?.length) return false;
  const { PoseLandmarker } = deps;

  const landmarks = mostProminentPose(result.landmarks);
  const connections = bodyConnections(PoseLandmarker);
  const joints      = bodyLandmarks(landmarks);

  // Glow pass: thick, low-alpha line underneath for a soft neon halo
  ctx.save();
  ctx.shadowColor = SKELETON_COLOR;
  ctx.shadowBlur = 18;
  drawingUtils.drawConnectors(landmarks, connections, {
    color: SKELETON_COLOR,
    lineWidth: 5,
  });
  ctx.restore();

  // Joints — body only, no face dots
  drawingUtils.drawLandmarks(joints, {
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
//  Registry. Each effect declares which detector it needs ('pose' | 'face').
// ---------------------------------------------------------------------------
export const EFFECTS = {
  skeleton: { label: "SKELETON",   detector: "pose", draw: drawSkeleton },
  mesh:     { label: "FACE MESH",  detector: "face", draw: drawMesh },
};
