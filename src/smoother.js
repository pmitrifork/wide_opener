// ============================================================================
//  SMOOTHER  —  exponential moving average over landmark arrays
//  Reduces per-frame jitter without adding latency beyond one frame.
//
//  alpha: blend weight for the NEW frame (0 = frozen, 1 = no smoothing).
//  Lower values = smoother but slightly more lag.  0.4–0.6 is a good range.
// ============================================================================

export class Smoother {
  constructor(alpha = 0.5) {
    this.alpha = alpha;
    this._prev = null; // array of arrays of {x,y,z}
  }

  // Accepts result.landmarks or result.faceLandmarks (both are arrays-of-arrays).
  // Returns a smoothed copy; the original result object is not mutated.
  smooth(landmarkGroups) {
    if (!landmarkGroups?.length) {
      this._prev = null;
      return landmarkGroups;
    }

    const alpha = this.alpha;
    const prev  = this._prev;

    const smoothed = landmarkGroups.map((group, gi) => {
      const prevGroup = prev?.[gi];
      return group.map((lm, li) => {
        const p = prevGroup?.[li];
        if (!p) return { ...lm };
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
