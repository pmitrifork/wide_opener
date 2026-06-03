# ============================================================================
#  download-assets.ps1  —  vendor the MediaPipe library + models into ./vendor
#  so the demo runs fully OFFLINE.  Run once on a machine WITH internet:
#
#      powershell -ExecutionPolicy Bypass -File .\download-assets.ps1
#
#  Then set  source: "local"  in src/config.js
# ============================================================================

# Pin a version for reproducibility. "latest" works but can change under you.
$VERSION = "latest"
$CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@$VERSION"
$MODELS = "https://storage.googleapis.com/mediapipe-models"

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path ".\vendor\wasm" | Out-Null

function Get-File($url, $out) {
  Write-Host "  $out"
  Invoke-WebRequest -Uri $url -OutFile $out
}

Write-Host "Downloading library bundle..."
Get-File "$CDN/vision_bundle.mjs" ".\vendor\vision_bundle.mjs"

Write-Host "Downloading wasm runtime..."
foreach ($f in @(
  "vision_wasm_internal.js", "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm")) {
  Get-File "$CDN/wasm/$f" ".\vendor\wasm\$f"
}

Write-Host "Downloading models..."
Get-File "$MODELS/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" ".\vendor\pose_landmarker_lite.task"
Get-File "$MODELS/face_landmarker/face_landmarker/float16/1/face_landmarker.task" ".\vendor\face_landmarker.task"

Write-Host ""
Write-Host "Done. Now set  source: 'local'  in src/config.js" -ForegroundColor Green
