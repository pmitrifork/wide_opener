// ============================================================================
//  MAIN  —  camera + MediaPipe + render loop
// ============================================================================
import { CONFIG } from "./config.js";
import { EFFECTS, faceRegionPath, buildBodyMesh } from "./effects.js";
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
  poseMiss: 0,           // consecutive video frames with no pose detected
  faceMiss: 0,           // consecutive video frames with no face detected
  lastAction: null,      // last gesture sound action played (rising-edge debounce)
  candidate: null,       // gesture being considered (stability gate)
  candFrames: 0,         // consecutive frames the candidate has held
  muzzle: null,          // { x, y, angle, time } for the gun muzzle flash
};
let poseLandmarker = null;
let faceLandmarker = null;
let gestureRecognizer = null;
let mpClasses = null; // { PoseLandmarker, FaceLandmarker, DrawingUtils }
let drawingUtils = null;
const poseSmoother = new Smoother(CONFIG.smooth);
const faceSmoother = new Smoother(CONFIG.smooth);

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
  state.poseMiss = 0;
  state.faceMiss = 0;
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
  const { FilesetResolver, PoseLandmarker, FaceLandmarker, GestureRecognizer, DrawingUtils } = mp;
  mpClasses = { PoseLandmarker, FaceLandmarker, GestureRecognizer, DrawingUtils };

  const fileset = await FilesetResolver.forVisionTasks(src.wasm);

  setStatus("loading pose model…");
  poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: src.poseModel, delegate: CONFIG.delegate },
    runningMode: "VIDEO",
    numPoses: CONFIG.numPoses,
    outputSegmentationMasks: true,  // person silhouette for the BODY MESH effect
  });

  setStatus("loading face model…");
  faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: src.faceModel, delegate: CONFIG.delegate },
    runningMode: "VIDEO",
    numFaces: CONFIG.numFaces,
    minFaceDetectionConfidence: CONFIG.minFaceDetectionConfidence,
    minFacePresenceConfidence:  CONFIG.minFacePresenceConfidence,
    minTrackingConfidence:      CONFIG.minFaceTrackingConfidence,
  });

  if (CONFIG.enableGestures) {
    setStatus("loading gesture model…");
    gestureRecognizer = await GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: src.gestureModel, delegate: CONFIG.delegate },
      runningMode: "VIDEO",
      numHands: CONFIG.numHands,
    });
  }

  drawingUtils = new DrawingUtils(ctx);
}

// ---------------------------------------------------------------------------
//  Gesture sounds  —  all routed through Web Audio. iOS reliably plays clips
//  via the AudioContext (unlocked on first tap) but is flaky unlocking many
//  separate <audio> elements, so we decode the MP3s into buffers instead.
// ---------------------------------------------------------------------------
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const buffers = {};   // url -> decoded AudioBuffer

async function loadBuffer(url) {
  try {
    const res = await fetch(url);
    buffers[url] = await audioCtx.decodeAudioData(await res.arrayBuffer());
  } catch (e) {
    console.warn("audio load failed:", url, e);
  }
}
function makeSfx(url) {
  loadBuffer(url);
  return () => {
    const b = buffers[url];
    if (!b) return;
    if (audioCtx.state === "suspended") audioCtx.resume();
    const s = audioCtx.createBufferSource();
    s.buffer = b;
    s.connect(audioCtx.destination);
    s.start();
  };
}
const playApplause   = makeSfx("./applause.mp3");
const playGunshot    = makeSfx("./gunshot.mp3");
const playGunshot2   = makeSfx("./gunshot2.mp3");
const playMachinegun = makeSfx("./machinegun.mp3");
const playBoo        = makeSfx("./boo.mp3");
const playGetuppa    = makeSfx("./getuppa.mp3");
const playAngel      = makeSfx("./angel.mp3");
const playCowboy     = makeSfx("./cowboy.mp3");
const playDevil      = makeSfx("./devil.mp3");

// Sounds played when switching into a particular effect
const EFFECT_ENTER_SOUNDS = {
  afro:   playGetuppa,
  halo:   playAngel,
  cowboy: playCowboy,
  devil:  playDevil,
};

// Short synthesized "ding" for a single thumbs-up
function playDing() {
  if (audioCtx.state === "suspended") audioCtx.resume();
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(880, t);
  o.frequency.exponentialRampToValueAtTime(1320, t + 0.12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  o.connect(g).connect(audioCtx.destination);
  o.start(t);
  o.stop(t + 0.36);
}

const GESTURE_SOUNDS = {
  applause:   playApplause,
  ding:       playDing,
  boo:        playBoo,
  gun:        playGunshot,
  gun2:       playGunshot2,
  machinegun: playMachinegun,
};

// Resume the (initially suspended) AudioContext on the first user interaction.
function unlockAudio() {
  if (audioCtx.state === "suspended") audioCtx.resume();
}
["pointerdown", "touchstart", "keydown", "click"].forEach((ev) =>
  window.addEventListener(ev, unlockAudio)
);

// Finger-gun detector from MediaPipe hand landmarks (21 pts per hand).
// Gun = index extended, thumb extended, middle/ring/pinky folded.
function isFingerGun(lm) {
  const W = lm[0];
  const d = (p) => Math.hypot(p.x - W.x, p.y - W.y); // distance from wrist
  const extended = (tip, pip) => d(lm[tip]) > d(lm[pip]) * 1.0;
  const folded   = (tip, pip) => d(lm[tip]) < d(lm[pip]);
  return (
    extended(8, 6) &&    // index extended
    extended(4, 3) &&    // thumb extended (cocked up)
    folded(12, 10) &&    // middle folded
    folded(16, 14) &&    // ring folded
    folded(20, 18)       // pinky folded
  );
}

// Double-barrel finger gun: index AND middle extended, ring/pinky folded.
function isDoubleGun(lm) {
  const W = lm[0];
  const d = (p) => Math.hypot(p.x - W.x, p.y - W.y);
  const extended = (tip, pip) => d(lm[tip]) > d(lm[pip]) * 1.0;
  const folded   = (tip, pip) => d(lm[tip]) < d(lm[pip]);
  return (
    extended(8, 6) &&    // index extended
    extended(12, 10) &&  // middle extended
    folded(16, 14) &&    // ring folded
    folded(20, 18)       // pinky folded
  );
}

// Validate a real thumbs-down: thumb extended AND pointing down, fingers
// folded. Gates MediaPipe's loose Thumb_Down classification.
function isThumbDown(lm) {
  if (!lm || lm.length < 21) return false;
  const W = lm[0];
  const d = (p) => Math.hypot(p.x - W.x, p.y - W.y);
  const folded = (tip, pip) => d(lm[tip]) < d(lm[pip]);
  const thumbExtended  = d(lm[4]) > d(lm[2]);          // tip beyond the knuckle
  const thumbPointsDown = lm[4].y > lm[2].y + 0.04;    // tip clearly below its base (y grows down)
  return (
    thumbExtended && thumbPointsDown &&
    folded(8, 6) && folded(12, 10) && folded(16, 14) && folded(20, 18)
  );
}

// ---------------------------------------------------------------------------
//  Muzzle flash — a quick burst at the fingertip when the gun fires
// ---------------------------------------------------------------------------
const MUZZLE_MS = 150;
function drawMuzzleFlash(now) {
  if (!state.muzzle) return;
  const age = now - state.muzzle.time;
  if (age > MUZZLE_MS) { state.muzzle = null; return; }

  const p = 1 - age / MUZZLE_MS;            // 1 → 0 over the lifetime
  const x = state.muzzle.x * canvas.width;
  const y = state.muzzle.y * canvas.height;
  const r = canvas.width * 0.05 * (0.6 + p * 0.7);

  ctx.save();
  ctx.globalCompositeOperation = "lighter"; // additive → bright burst

  // Faint full-screen flash
  ctx.fillStyle = `rgba(255, 240, 200, ${0.12 * p})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Radial burst at the muzzle
  ctx.translate(x, y);
  ctx.rotate(state.muzzle.angle);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0,   `rgba(255,255,235,${0.95 * p})`);
  g.addColorStop(0.3, `rgba(255,200,90,${0.7 * p})`);
  g.addColorStop(1,   "rgba(255,120,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  // A few spikes for a star-burst look
  ctx.fillStyle = `rgba(255,245,200,${0.85 * p})`;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const lng = r * (1.8 + (i % 2));
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2);
    ctx.lineTo(Math.cos(a) * lng, Math.sin(a) * lng);
    ctx.lineTo(Math.cos(a + 0.18) * r * 0.18, Math.sin(a + 0.18) * r * 0.18);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
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

  // For effects that opt into keepFace: when the background is replaced
  // (black / image), still reveal the live face within the head region so the
  // person stays visible (e.g. their face inside the afro).
  if (eff.keepFace && state.bgMode !== "video" && state.lastFaceResult?.faceLandmarks?.length) {
    for (const lms of state.lastFaceResult.faceLandmarks) {
      ctx.save();
      ctx.clip(faceRegionPath(lms, canvas.width, canvas.height, CONFIG.faceCutoutExpand));
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
  }

  // Only run detectors when a new video frame has arrived
  if (cameraReady && video.currentTime !== state.lastVideoTime) {
    state.lastVideoTime = video.currentTime;
    const needsPose = eff.detector === "pose" || eff.detector === "both";
    const needsFace = eff.detector === "face" || eff.detector === "both";
    if (needsPose) {
      const r = poseLandmarker.detectForVideo(video, now);
      if (r.landmarks?.length) {
        state.lastPoseResult = { ...r, landmarks: poseSmoother.smooth(r.landmarks) };
        state.poseMiss = 0;
      } else if (++state.poseMiss > CONFIG.holdFrames) {
        // Detection gone for long enough — drop the held result so it clears
        state.lastPoseResult = null;
        poseSmoother.reset();
      }
      // Build the body-silhouette Voronoi mesh from the segmentation mask
      if (eff.usesMask && r.segmentationMasks?.length) {
        buildBodyMesh(r.segmentationMasks[0], canvas.width, canvas.height);
      }
      // Free the mask buffers (we've consumed them this frame)
      r.segmentationMasks?.forEach((m) => m.close?.());
    }
    if (needsFace) {
      const r = faceLandmarker.detectForVideo(video, now);
      if (r.faceLandmarks?.length) {
        state.lastFaceResult = { ...r, faceLandmarks: faceSmoother.smooth(r.faceLandmarks) };
        state.faceMiss = 0;
      } else if (++state.faceMiss > CONFIG.holdFrames) {
        state.lastFaceResult = null;
        faceSmoother.reset();
      }
    }

    // Hand gestures — independent of the current effect
    if (gestureRecognizer) {
      const gr = gestureRecognizer.recognizeForVideo(video, now);
      // Pair each hand's gesture label with its landmarks (same index)
      const hands = (gr.gestures || []).map((g, i) => ({
        name:  g[0]?.categoryName,
        score: g[0]?.score || 0,
        lm:    gr.landmarks?.[i],
      }));
      const min = CONFIG.gestureMinScore;

      const thumbsUp = hands.filter((hd) => hd.name === "Thumb_Up" && hd.score >= min).length;
      // Thumb_Down must also pass the landmark check (extended + pointing down)
      const thumbsDown = hands.filter(
        (hd) => hd.name === "Thumb_Down" && hd.score >= min && isThumbDown(hd.lm)
      ).length;
      // Double gun checked first (it needs the middle finger extended, which
      // the single gun forbids — so they're mutually exclusive)
      const gun2Hand = hands.find((hd) => hd.lm?.length >= 21 && isDoubleGun(hd.lm))?.lm;
      const gunHand  = hands.find((hd) => hd.lm?.length >= 21 && isFingerGun(hd.lm))?.lm;
      // How many hands are making any gun gesture
      const gunHands = hands.filter(
        (hd) => hd.lm?.length >= 21 && (isFingerGun(hd.lm) || isDoubleGun(hd.lm))
      ).length;

      // Gun gestures only fire in COWBOY mode (hat on)
      const gunsArmed = state.effect === "cowboy";

      // Resolve to a single action (priority order)
      let action = null;
      if (thumbsUp >= 2)      action = "applause";
      else if (thumbsUp === 1) action = "ding";
      else if (thumbsDown >= 1) action = "boo";
      else if (gunsArmed && gunHands >= 2) action = "machinegun";  // both hands = guns
      else if (gunsArmed && gun2Hand)      action = "gun2";
      else if (gunsArmed && gunHand)       action = "gun";

      // Stability gate: a gesture must persist for a few consecutive frames
      // before it fires, so single-frame noise (e.g. as the model warms up or
      // a hand passes by) can't trigger a sound.
      if (action === state.candidate) state.candFrames++;
      else { state.candidate = action; state.candFrames = 1; }

      if (state.candFrames === CONFIG.gestureStableFrames) {
        if (action && action !== state.lastAction) {
          GESTURE_SOUNDS[action]();
          const aimHand =
            action === "gun" ? gunHand :
            action === "gun2" ? gun2Hand :
            action === "machinegun" ? (gun2Hand || gunHand) : null;
          if (aimHand) {
            // Muzzle just past the index fingertip, aimed along the finger
            const tip = aimHand[8], mcp = aimHand[5];
            let dx = tip.x - mcp.x, dy = tip.y - mcp.y;
            const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
            state.muzzle = {
              x: tip.x + dx * 0.03,
              y: tip.y + dy * 0.03,
              angle: Math.atan2(dy, dx),
              time: now,
            };
          }
        }
        state.lastAction = action;   // null resets so a gesture can refire later
      }
    }
  }

  // Always draw the last known result — even on rAF ticks where the video
  // frame didn't advance yet. This prevents the mesh going blank for one frame
  // whenever the detector or video pipeline hiccups.
  // Wrapped so an effect throwing can never kill the render loop / freeze video.
  try {
    if (eff.detector === "both") {
      // Pass both results; effect decides how to combine them
      if (state.lastPoseResult || state.lastFaceResult) {
        drewSomething = eff.draw(ctx, drawingUtils,
          { pose: state.lastPoseResult, face: state.lastFaceResult }, mpClasses);
      }
    } else if (eff.detector === "pose" && state.lastPoseResult) {
      drewSomething = eff.draw(ctx, drawingUtils, state.lastPoseResult, mpClasses);
    } else if (eff.detector === "face" && state.lastFaceResult) {
      drewSomething = eff.draw(ctx, drawingUtils, state.lastFaceResult, mpClasses);
    }
  } catch (err) {
    console.error("effect draw error:", err);
  }

  drawMuzzleFlash(now);   // on top of the effect, still inside the mirror frame
  ctx.restore();

  // Idle handling — hysteresis so the overlay doesn't flicker on the boundary:
  // show after idleAfterFrames empty frames, but only hide after a few filled.
  // (Held results are expired above, driven by missed detections.)
  if (drewSomething) {
    state.filledFrames++;
    if (state.filledFrames >= CONFIG.filledFramesBeforeHide) state.emptyFrames = 0;
  } else {
    state.emptyFrames++;
    state.filledFrames = 0;
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
    EFFECT_ENTER_SOUNDS[state.effect]?.();   // play the effect's entry sound
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
