// ============================================================================
//  SMOOTHER  —  adaptive (speed-dependent) EMA over landmark arrays
//
//  A fixed EMA forces a trade-off: low alpha kills jitter but lags during
//  motion; high alpha is responsive but jittery when still. This filter adapts
//  per-landmark: when a point barely moves (jitter), it uses a LOW alpha (heavy
//  smoothing); when it moves fast (real motion), it ramps toward a HIGH alpha
//  (responsive). This removes still-input jitter without adding visible lag.
//
//    minAlpha   — blend weight when essentially still (small = very smooth)
//    maxAlpha   — blend weight when moving fast (large = responsive)
//    motionRef  — movement (in normalised units) that reaches maxAlpha
// ============================================================================

export class Smoother {
  constructor({ minAlpha = 0.12, maxAlpha = 0.85, motionRef = 0.03 } = {}) {
    this.minAlpha = minAlpha;
    this.maxAlpha = maxAlpha;
    this.motionRef = motionRef;
    this._prev = null; // array of arrays of {x,y,z}
  }

  // Accepts result.landmarks or result.faceLandmarks (both arrays-of-arrays).
  // Returns a smoothed copy; the original result object is not mutated.
  smooth(landmarkGroups) {
    if (!landmarkGroups?.length) {
      this._prev = null;
      return landmarkGroups;
    }

    const { minAlpha, maxAlpha, motionRef } = this;
    const prev = this._prev;

    const smoothed = landmarkGroups.map((group, gi) => {
      const prevGroup = prev?.[gi];
      return group.map((lm, li) => {
        const p = prevGroup?.[li];
        if (!p) return { ...lm };

        // Per-landmark speed → adaptive alpha
        const dx = lm.x - p.x, dy = lm.y - p.y;
        const dist = Math.hypot(dx, dy);
        const t = Math.min(dist / motionRef, 1);     // 0 still … 1 fast
        const alpha = minAlpha + (maxAlpha - minAlpha) * t;

        return {
          x: alpha * lm.x + (1 - alpha) * p.x,
          y: alpha * lm.y + (1 - alpha) * p.y,
          z: alpha * lm.z + (1 - alpha) * p.z,
          visibility: lm.visibility,
        };
      });
    });

    this._prev = smoothed;
    return smoothed;
  }

  reset() { this._prev = null; }
}
