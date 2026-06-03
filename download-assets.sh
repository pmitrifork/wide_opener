#!/usr/bin/env bash
# ============================================================================
#  download-assets.sh  —  vendor the MediaPipe library + models into ./vendor
#  so the demo runs fully OFFLINE.  Run once on a machine WITH internet:
#
#      bash download-assets.sh
#
#  Then set  source: "local"  in src/config.js
# ============================================================================
set -euo pipefail

VERSION="latest"   # pin (e.g. "0.10.22") for reproducibility
CDN="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}"
MODELS="https://storage.googleapis.com/mediapipe-models"

mkdir -p vendor/wasm

echo "Downloading library bundle..."
curl -fsSL "$CDN/vision_bundle.mjs" -o vendor/vision_bundle.mjs

echo "Downloading wasm runtime..."
for f in vision_wasm_internal.js vision_wasm_internal.wasm \
         vision_wasm_nosimd_internal.js vision_wasm_nosimd_internal.wasm; do
  echo "  $f"
  curl -fsSL "$CDN/wasm/$f" -o "vendor/wasm/$f"
done

echo "Downloading models..."
curl -fsSL "$MODELS/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" -o vendor/pose_landmarker_lite.task
curl -fsSL "$MODELS/face_landmarker/face_landmarker/float16/1/face_landmarker.task"            -o vendor/face_landmarker.task

echo ""
echo "Done. Now set  source: 'local'  in src/config.js"
