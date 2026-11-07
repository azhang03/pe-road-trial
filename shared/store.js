// Review counts and saved data in localStorage.
// The right and wrong counts are shared by all prototypes.
// Other data is kept apart for each prototype.

const STATS_KEY = 'pe-trials:stats';

/** Read JSON from localStorage. Bad or missing data gives the fallback. */
function readJson(key, fallback) {
  let text = null;
  try {
    text = localStorage.getItem(key);
  } catch {
    return fallback;
  }
  if (text === null) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked. The game goes on without it.
  }
}

function readStats() {
  const raw = readJson(STATS_KEY, {});
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [gen, c] of Object.entries(raw)) {
    if (!c || typeof c !== 'object') continue;
    const right = Number.isFinite(c.right) && c.right > 0 ? Math.floor(c.right) : 0;
    const wrong = Number.isFinite(c.wrong) && c.wrong > 0 ? Math.floor(c.wrong) : 0;
    out[gen] = { right, wrong };
  }
  return out;
}

/** name: 'm1' or 'm2'. */
export function createStore(name) {
  const prefix = `pe-trials:${name}:`;

  return {
    /** Add one right or wrong answer for the generator. */
    record(gen, correct) {
      const stats = readStats();
      const c = stats[gen] ?? { right: 0, wrong: 0 };
      if (correct) c.right += 1;
      else c.wrong += 1;
      stats[gen] = c;
      writeJson(STATS_KEY, stats);
    },

    /** { [gen]: { right, wrong } } */
    stats() {
      return readStats();
    },

    /**
     * A generator id that the player missed, or null.
     * Only ids in gens with wrong > 0 can come out. The weight is wrong / (right + 1).
     */
    reviewPick(rng, gens) {
      const stats = readStats();
      const pool = [];
      let total = 0;
      for (const gen of gens) {
        const c = stats[gen];
        if (!c || c.wrong <= 0) continue;
        const w = c.wrong / (c.right + 1);
        pool.push([gen, w]);
        total += w;
      }
      if (pool.length === 0) return null;
      let r = rng() * total;
      for (const [gen, w] of pool) {
        r -= w;
        if (r < 0) return gen;
      }
      return pool[pool.length - 1][0];
    },

    /** The saved value, or null if there is none or it is bad. */
    load(key) {
      return readJson(prefix + key, null);
    },

    save(key, value) {
      writeJson(prefix + key, value);
    },

    remove(key) {
      try {
        localStorage.removeItem(prefix + key);
      } catch {
        // Nothing to do.
      }
    },
  };
}
