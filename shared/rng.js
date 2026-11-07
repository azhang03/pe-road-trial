// A seeded random source (mulberry32). The same seed gives the same run.

export function createRandom(seed = Date.now()) {
  let a = seed >>> 0;
  function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** An integer from a to b. Both ends are included. */
  rng.int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  rng.pick = (list) => list[Math.floor(rng() * list.length)];
  /** A new array in random order. The input does not change. */
  rng.shuffle = (list) => {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  rng.chance = (p) => rng() < p;
  return rng;
}
