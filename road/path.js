// Road paths: samples { x, y, z, h, bank }. No Three.js.
// h is the heading: the road goes along (cos h, 0, sin h). y is the elevation of the road center.
// p = (-sin h, 0, cos h) is the right side of the road. A positive bank lifts the +p side.

import { surfaceY } from './world.js';

const STEP = 0.3;

/** A path that grows from a start point. All new samples keep the elevation of the last one. */
export function pathFrom(x, z, h, y = 0) {
  const pts = [{ x, y, z, h, bank: 0 }];
  const last = () => pts[pts.length - 1];
  return {
    pts,
    last,
    /** The count of samples so far. Use it to mark parts of the path. */
    get n() {
      return pts.length;
    },
    straight(len) {
      const e = last();
      const n = Math.max(1, Math.ceil(len / STEP));
      for (let i = 1; i <= n; i++) {
        const t = (len * i) / n;
        pts.push({ x: e.x + Math.cos(e.h) * t, y: e.y, z: e.z + Math.sin(e.h) * t, h: e.h, bank: 0 });
      }
    },
    /** A circular arc. A positive angle turns toward +p (a right turn). Returns the circle. */
    arc(R, angle) {
      const e = last();
      const s = Math.sign(angle) || 1;
      const cx = e.x - Math.sin(e.h) * s * R;
      const cz = e.z + Math.cos(e.h) * s * R;
      const psi0 = Math.atan2(e.z - cz, e.x - cx);
      const n = Math.max(2, Math.ceil((R * Math.abs(angle)) / STEP));
      for (let i = 1; i <= n; i++) {
        const k = (angle * i) / n;
        pts.push({ x: cx + R * Math.cos(psi0 + k), y: e.y, z: cz + R * Math.sin(psi0 + k), h: e.h + k, bank: 0 });
      }
      return { cx, cz, R, psi0, psi1: psi0 + angle, side: s };
    },
    /** A sharp corner: the same point with a new heading. */
    turnTo(h) {
      const e = last();
      pts.push({ x: e.x, y: e.y, z: e.z, h, bank: 0 });
    },
    /** A straight line to a point, with a sharp corner at the start. */
    lineTo(x, z) {
      const e = last();
      const h = Math.atan2(z - e.z, x - e.x);
      this.turnTo(h);
      this.straight(Math.hypot(x - e.x, z - e.z));
    },
  };
}

/** The length along a sample list. */
export function pathLength(samples) {
  let d = 0;
  for (let i = 1; i < samples.length; i++) d += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
  return d;
}

/** The distance from the start of each sample, in plan. */
export function distances(samples) {
  let d = 0;
  return samples.map((s, i) => {
    if (i > 0) d += Math.hypot(s.x - samples[i - 1].x, s.z - samples[i - 1].z);
    return d;
  });
}

/**
 * The path of a car in a lane: `offset` to the right of the road center.
 * With `reverse`, the car drives from the end to the start (its right is then the other side).
 * Each point gets y (the road surface) and d (the distance from the start).
 */
export function lanePath(samples, offset, reverse = false) {
  const src = reverse
    ? samples
        .slice()
        .reverse()
        .map((s) => ({ ...s, h: s.h + Math.PI, bank: -(s.bank ?? 0) }))
    : samples;
  let d = 0;
  let px = 0;
  let pz = 0;
  return src.map((s, i) => {
    const b = s.bank ?? 0;
    const x = s.x - Math.sin(s.h) * offset * Math.cos(b);
    const z = s.z + Math.cos(s.h) * offset * Math.cos(b);
    if (i > 0) d += Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
    return { x, z, y: surfaceY(offset, b) + (s.y ?? 0), h: s.h, bank: b, d };
  });
}

const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/** The point at distance d along a lane path. `grade` is the rise for each unit of run. */
export function pointAt(path, d) {
  if (d <= 0) return { ...path[0], grade: 0 };
  const lastP = path[path.length - 1];
  if (d >= lastP.d) return { ...lastP, grade: 0 };
  let lo = 0;
  let hi = path.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid].d <= d) lo = mid;
    else hi = mid;
  }
  const a = path[lo];
  const b = path[hi];
  const span = b.d - a.d;
  const t = span > 1e-9 ? (d - a.d) / span : 1;
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    y: a.y + (b.y - a.y) * t,
    h: lerpAngle(a.h, b.h, t),
    bank: a.bank + (b.bank - a.bank) * t,
    grade: span > 1e-6 ? (b.y - a.y) / span : 0,
    d,
  };
}

/** The distance along a lane path of the sample nearest to a point. */
export function distanceOf(path, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (const p of path) {
    const q = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (q < bestD) {
      bestD = q;
      best = p.d;
    }
  }
  return best;
}

/** Samples shifted sideways by `offset` (toward +p). Keeps the headings. */
export function offsetSamples(samples, offset) {
  return samples.map((s) => ({ x: s.x - Math.sin(s.h) * offset, y: s.y ?? 0, z: s.z + Math.cos(s.h) * offset, h: s.h, bank: 0 }));
}
