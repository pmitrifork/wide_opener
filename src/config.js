// ============================================================================
//  CONFIG  —  the only file you should normally need to touch
// ============================================================================

export const CONFIG = {
  // Where to load the MediaPipe library, wasm runtime, and models from.
  //   'cdn'   -> pulls everything from jsDelivr / Google at runtime (needs internet)
  //   'local' -> uses files in ./vendor (run download-assets first; works offline)
  source: "cdn",

  // --- CDN sources (default) -------------------------------------------------
  cdn: {
    bundle:    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs",
    wasm:      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm",
    poseModel: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    faceModel: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  },

  // --- Local / offline sources (populated by download-assets) ----------------
  local: {
    bundle:    "./vendor/vision_bundle.mjs",
    wasm:      "./vendor/wasm",
    poseModel: "./vendor/pose_landmarker_lite.task",
    faceModel: "./vendor/face_landmarker.task",
  },

  // --- Camera ----------------------------------------------------------------
  camera: {
    width:  1280,   // requested; the browser picks the closest it can do
    height: 720,
    facingMode: "user",
  },

  // --- Detection -------------------------------------------------------------
  numPoses: 3,        // render only the single most prominent person
  numFaces: 10,
  delegate: "GPU",    // "GPU" (fast, WebGL) or "CPU" (fallback if GPU misbehaves)

  // --- Look & feel -----------------------------------------------------------
  startEffect: "skeleton",  // "skeleton" | "mesh"
  showVideo:   true,        // true = draw camera behind effect; false = effect on pure black
  mirror:      false,       // selfie flip (left/right). Toggle live with 'M'

  // Landmark smoothing — adaptive (speed-dependent) EMA.
  //   minAlpha  : blend weight when nearly still (lower = kills jitter harder)
  //   maxAlpha  : blend weight when moving fast  (higher = more responsive)
  //   motionRef : movement (normalised 0–1 units) at which maxAlpha is reached
  smooth: { minAlpha: 0.12, maxAlpha: 0.85, motionRef: 0.03 },

  // For keepFace effects (e.g. afro): how far to expand the revealed face
  // region beyond the face oval when the background is replaced (1 = exact).
  faceCutoutExpand: 1.15,

  // Idle screen appears after this many consecutive frames with nobody detected
  idleAfterFrames: 25,
  // How many consecutive detected frames required before the idle overlay hides
  // (prevents it flickering on/off at the boundary)
  filledFramesBeforeHide: 8,
  // How many empty frames to hold the last known skeleton before clearing it
  // (prevents 1-2 frame gaps in detection from causing a visible flicker)
  holdFrames: 6,
};
