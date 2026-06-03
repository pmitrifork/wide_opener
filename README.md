# Human FX

Real-time human detection with a visual effect (glowing **skeleton** or white **face mesh**),
running in the browser from a webcam. Built for an installation: camera in a room,
output fullscreen on a screen.

Stack: plain HTML/JS + [`@mediapipe/tasks-vision`](https://www.npmjs.com/package/@mediapipe/tasks-vision)
(Pose Landmarker + Face Landmarker). No build step, no framework.

---

## Run it (Windows, built-in webcam)

You need a local web server — opening `index.html` as a `file://` will **not** work
(the camera and ES modules require an `http://localhost` origin).

```powershell
cd human-fx-demo
python serve.py
```

Then open **http://localhost:8000** and allow camera access. That's it.

> No Python? `npx serve` or any static server works too — just keep the origin on `localhost`.

The library and ML models stream from a CDN on first load (needs internet **once**,
then the browser caches them). For a fully offline installation, see *Offline* below.

---

## Controls (keyboard)

| Key | Action |
|-----|--------|
| `E` | cycle effect (skeleton ↔ face mesh) |
| `B` | background: live video ↔ pure black |
| `M` | mirror (selfie flip) |
| `F` | fullscreen |
| `H` | hide / show the HUD |

The HUD bottom-left shows the active effect and live FPS. When nobody is in frame
for ~1s, a **STEP INTO FRAME** idle prompt fades in.

---

## Tuning — everything lives in `src/config.js`

- **Performance**: drop `camera.width/height` to `640 / 480` for a big FPS boost.
  Keep `delegate: "GPU"`; switch to `"CPU"` only if the GPU path misbehaves.
- **One person**: `numPoses` / `numFaces` are set to `1` — only the most prominent
  subject is rendered, even in a crowd.
- **Default look**: `startEffect`, `showVideo` (effect-on-black is the moodier
  installation look), and `mirror`.

> For a walk-around space at a **distance**, the **skeleton** is the more reliable
> default — the face mesh needs faces fairly close and well-lit.

---

## Offline / unattended installation

Vendor the library + models locally so there's no CDN dependency at showtime.
On a machine with internet, run once:

```powershell
powershell -ExecutionPolicy Bypass -File .\download-assets.ps1   # Windows
# or:  bash download-assets.sh                                    # macOS/Linux
```

Then set `source: "local"` in `src/config.js`. Everything now loads from `./vendor`.

---

## Project layout

```
human-fx-demo/
├── index.html            # entry: video + canvas stage + HUD
├── serve.py              # local static server (correct MIME types)
├── download-assets.*     # optional: vendor libs/models for offline
├── vendor/               # populated by download-assets
└── src/
    ├── config.js         # ← the knobs you'll actually touch
    ├── main.js           # camera + MediaPipe + render loop
    ├── effects.js        # skeleton & mesh drawing (add new effects here)
    └── style.css         # dark motion-capture look
```

## Adding a new effect

Write a `draw(ctx, drawingUtils, result, deps)` function in `effects.js`, then add it
to the `EFFECTS` registry with the detector it needs (`"pose"` or `"face"`).
It joins the `E`-key rotation automatically.

---

## Where this sits in the 12h plan

- **Phase 0–2 (setup, detection, skeleton):** ✅ done — this scaffold runs and shows
  the skeleton effect out of the box.
- **Phase 3 (white mesh):** ✅ included as the second effect.
- **Phase 4 (perf & polish):** start from `config.js` (resolution), the idle state and
  effect-on-black are already wired.
- **Phase 5 (demo hardening):** test on the real machine/lighting; vendor assets offline;
  keep a recorded clip as a fallback.

Possible next steps: full-body white mesh via a segmentation mask, smoothing/interpolation
between frames, or a particle/trail effect off the joint positions.
