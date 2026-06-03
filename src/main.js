// ============================================================================
//  MAIN  —  camera + MediaPipe + render loop
// ============================================================================
import { CONFIG } from "./config.js";
import { EFFECTS } from "./effects.js";
import { Smoother } from "./smoother.js";

const src = CONFIG[CONFIG.source]; // resolve 'cdn' or 'local' URLs

// DOM
const video   = document.getElementById("cam");
const canvas  = document.getElementById("stage");
const ctx     = canvas.getContext("2d");
const hud      = document.getElementById("hud");
const statusEl = document.getElementById("status");
const idleEl   = document.getElementById("idle");
const fpsEl    = document.getElementById("fps");
const effEl    = document.getElementById("eff");

// Preload background image
const bgImage = new Image();
bgImage.src = "./background.jpg";

const BG_MODES = ["video", "black", "image"];

// Runtime state
let state = {
  effect: CONFIG.startEffect,
  bgMode: CONFIG.showVideo ? "video" : "black",
  mirror: CONFIG.mirror,
  emptyFrames: 0,
  filledFrames: 0,       // consecutive frames with a detection
  lastVideoTime: -1,
  lastPoseResult: null,  // held for a few frames so one missed detection doesn't flicker
  lastFaceResult: null,
};
let poseLandmarker = null;
let faceLandmarker = null;
let mpClasses = null; // { PoseLandmarker, FaceLandmarker, DrawingUtils }
let drawingUtils = null;
const poseSmoother = new Smoother(CONFIG.smoothAlpha);
const faceSmoother = new Smoother(CONFIG.smoothAlpha);

function setStatus(msg) { statusEl.textContent = msg; }

// ---------------------------------------------------------------------------
//  1. Camera
// ---------------------------------------------------------------------------
let currentFacingMode = CONFIG.camera.facingMode;
let cameraReady = false;

async function startCamera(facingMode = currentFacingMode) {
  cameraReady = false;
  setStatus("switching camera…");
  // Stop any existing tracks before switching
  if (video.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
  currentFacingMode = facingMode;

  // iOS Safari needs `exact` to actually switch to the back camera;
  // use exact only when switching away from the default to avoid breaking
  // desktop browsers that don't understand the constraint.
  const facingConstraint = facingMode === "environment"
    ? { exact: "environment" }
    : "user";

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width:  { ideal: CONFIG.camera.width },
      height: { ideal: CONFIG.camera.height },
      facingMode: facingConstraint,
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  await new Promise((r) => {
    if (video.videoWidth) return r();
    video.onloadedmetadata = () => r();
  });
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  poseSmoother.reset();
  faceSmoother.reset();
  state.lastVideoTime = -1;
  state.lastPoseResult = null;
  state.lastFaceResult = null;
  state.emptyFrames = 0;
  state.filledFrames = 0;
  cameraReady = true;
  setStatus("");
}

// ---------------------------------------------------------------------------
//  2. MediaPipe — load library (CDN or local) and build the detectors
// ---------------------------------------------------------------------------
async function initMediaPipe() {
  setStatus("loading vision library…");
  const mp = await import(/* @vite-ignore */ src.bundle);
  const { FilesetResolver, PoseLandmarker, FaceLandmarker, DrawingUtils } = mp;
  mpClasses = { PoseLandmarker, FaceLandmarker, DrawingUtils };

  const fileset = await FilesetResolver.forVisionTasks(src.wasm);

  setStatus("loading pose model…");
  poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: src.poseModel, delegate: CONFIG.delegate },
    runningMode: "VIDEO",
    numPoses: CONFIG.numPoses,
  });

  setStatus("loading face model…");
  faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: src.faceModel, delegate: CONFIG.delegate },
    runningMode: "VIDEO",
    numFaces: CONFIG.numFaces,
  });

  drawingUtils = new DrawingUtils(ctx);
}

// ---------------------------------------------------------------------------
//  3. Render loop
// ---------------------------------------------------------------------------
let frames = 0, fpsClock = performance.now();

function tick() {
  const now = performance.now();

  // Compositing: mirror + background
  ctx.save();
  if (state.mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  if (state.bgMode === "video") {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  } else if (state.bgMode === "image" && bgImage.complete && bgImage.naturalWidth) {
    ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Only run the detector the current effect needs
  const eff = EFFECTS[state.effect];
  let drewSomething = false;

  // Only run the detector when a new video frame has arrived
  if (cameraReady && video.currentTime !== state.lastVideoTime) {
    state.lastVideoTime = video.currentTime;
    let result;
    if (eff.detector === "pose") {
      result = poseLandmarker.detectForVideo(video, now);
      if (result.landmarks?.length) {
        state.lastPoseResult = { ...result, landmarks: poseSmoother.smooth(result.landmarks) };
      }
    } else {
      result = faceLandmarker.detectForVideo(video, now);
      if (result.faceLandmarks?.length) {
        state.lastFaceResult = { ...result, faceLandmarks: faceSmoother.smooth(result.faceLandmarks) };
      }
    }
  }

  // Always draw the last known result — even on rAF ticks where the video
  // frame didn't advance yet. This is what prevents the mesh from going blank
  // for one frame whenever the detector or video pipeline hiccups.
  if (eff.detector === "pose" && state.lastPoseResult) {
    drewSomething = eff.draw(ctx, drawingUtils, state.lastPoseResult, mpClasses);
  } else if (eff.detector === "face" && state.lastFaceResult) {
    drewSomething = eff.draw(ctx, drawingUtils, state.lastFaceResult, mpClasses);
  }
  ctx.restore();

  // Idle handling — hysteresis so the overlay doesn't flicker on the boundary:
  // show after idleAfterFrames empty frames, but only hide after 8 filled frames.
  if (drewSomething) {
    state.filledFrames++;
    if (state.filledFrames >= CONFIG.filledFramesBeforeHide) state.emptyFrames = 0;
  } else {
    state.emptyFrames++;
    state.filledFrames = 0;
    // Expire the held result after a generous hold window
    if (state.emptyFrames > CONFIG.holdFrames) {
      state.lastPoseResult = null;
      state.lastFaceResult = null;
    }
  }
  idleEl.classList.toggle("show", state.emptyFrames > CONFIG.idleAfterFrames);

  // FPS
  frames++;
  if (now - fpsClock >= 500) {
    fpsEl.textContent = Math.round((frames * 1000) / (now - fpsClock)) + " fps";
    frames = 0;
    fpsClock = now;
  }

  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
//  4. Controls
// ---------------------------------------------------------------------------
const BG_LABELS = { video: "", black: " · BLACK", image: " · BG IMAGE" };
function refreshHud() {
  effEl.textContent = EFFECTS[state.effect].label + (BG_LABELS[state.bgMode] ?? "");
}

const effectKeys = Object.keys(EFFECTS);
function handleAction(k) {
  if (k === "e") {                       // cycle effect
    const i = effectKeys.indexOf(state.effect);
    state.effect = effectKeys[(i + 1) % effectKeys.length];
    refreshHud();
  } else if (k === "m") {                // mirror
    state.mirror = !state.mirror;
  } else if (k === "b") {                // background: video -> black -> image
    const i = BG_MODES.indexOf(state.bgMode);
    state.bgMode = BG_MODES[(i + 1) % BG_MODES.length];
    refreshHud();
  } else if (k === "h") {                // hide/show the HUD
    hud.classList.toggle("hidden");
  } else if (k === "f") {                // fullscreen
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  } else if (k === "c") {                // flip camera (front <-> back)
    const next = currentFacingMode === "user" ? "environment" : "user";
    startCamera(next).catch((err) => setStatus("cam error: " + err.message));
  }
}

window.addEventListener("keydown", (e) => handleAction(e.key.toLowerCase()));

document.getElementById("touch-controls").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (btn) handleAction(btn.dataset.action);
});

// ---------------------------------------------------------------------------
//  Boot
// ---------------------------------------------------------------------------
(async function main() {
  try {
    await startCamera();
    await initMediaPipe();
    refreshHud();
    setStatus("");
    cameraReady = true;
    hud.classList.add("ready");
    requestAnimationFrame(tick);
  } catch (err) {
    console.error(err);
    setStatus("ERROR: " + (err?.message || err) + "  (see console)");
  }
})();
