// The 3D scene: renderer, lights, ground, camera, and the shared model parts.
// The look copies the site trials (../../items/index.html and ../../actions/round2.html).

import * as THREE from 'three';

const { Vector3 } = THREE;

export const EL = THREE.MathUtils.degToRad(38);
const FOV = 12;
const DEG = Math.PI / 180;

// Small helpers.
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const ease = (x) => 1 - (1 - clamp01(x)) ** 3;
export const smooth = (x) => {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
};
export const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

// ---------- Materials and boxes ----------

export const unit = new THREE.BoxGeometry(1, 1, 1);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
const octGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
const mats = new Map();
/** One shared Lambert material for each color. */
export function mat(color) {
  if (!mats.has(color)) mats.set(color, new THREE.MeshLambertMaterial({ color }));
  return mats.get(color);
}

export function box(parent, [w, h, d], [x, y, z], color, rot) {
  const m = new THREE.Mesh(unit, mat(color));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(...rot);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

export function cyl(parent, r, h, [x, y, z], color, rot, sides = 12) {
  const m = new THREE.Mesh(sides === 8 ? octGeo : cylGeo, mat(color));
  m.scale.set(r, h, r);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(...rot);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export function group(parent, [x, y, z]) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** A label: bold text that fits the width, on a filled background. From the items trial. */
function textCanvas(text, w, h, fg, bg) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = bg;
  x.fillRect(0, 0, w, h);
  x.fillStyle = fg;
  let px = h * 0.62;
  x.font = `800 ${px}px system-ui, sans-serif`;
  const mw = x.measureText(text).width;
  if (mw > w * 0.9) {
    px *= (w * 0.9) / mw;
    x.font = `800 ${px}px system-ui, sans-serif`;
  }
  x.textBaseline = 'middle';
  x.textAlign = 'center';
  x.fillText(text, w / 2, h / 2);
  return c;
}

const labelMats = new Map();
/** A flat text plane that faces +z. */
export function label(parent, text, w, h, [x, y, z], fg, bg) {
  const key = `${text}|${fg}|${bg}|${w / h}`;
  if (!labelMats.has(key)) {
    const t = new THREE.CanvasTexture(textCanvas(text, Math.round(128 * (w / h)), 128, fg, bg));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    labelMats.set(key, new THREE.MeshLambertMaterial({ map: t }));
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), labelMats.get(key));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// ---------- The eagle (T2), copied from ../../actions/round2.html ----------

const C = {
  brown: '#55341d', wing: '#3e2514', white: '#f2efe7', tail: '#e6e1d6',
  beak: '#f6b92f', hook: '#d98d15', feet: '#f6b92f', talon: '#3a3a3c', eye: '#1c1c1e',
};
function ebox(parent, [w, h, d], [x, y, z], color, tilt = 0) {
  const m = new THREE.Mesh(unit, mat(color));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.rotation.x = tilt;
  m.castShadow = true;
  parent.add(m);
}
const HIP = 0.27;
/** The eagle is smaller here than on the site, so the road reads at its side. */
const EAGLE_SIZE = 0.72;
const HEAD_Z = 0.12;
function buildEagle() {
  const root = new THREE.Group();
  const legs = {};
  for (const s of [-1, 1]) {
    const leg = group(root, [s * 0.13, HIP, 0.04]);
    ebox(leg, [0.2, 0.05, 0.26], [0, 0.025 - HIP, 0.06], C.feet);
    for (const k of [-1, 0, 1]) ebox(leg, [0.045, 0.04, 0.05], [k * 0.07, 0.02 - HIP, 0.205], C.talon);
    ebox(leg, [0.08, 0.16, 0.08], [0, 0.08 - HIP, 0.02], C.feet);
    ebox(leg, [0.15, 0.15, 0.15], [0, 0.21 - HIP, 0], C.brown);
    legs[s] = leg;
  }
  const body = group(root, [0, HIP, 0]);
  const at = ([x, y, z]) => [x, y - HIP, z];
  ebox(body, [0.56, 0.66, 0.5], at([0, 0.62, 0.08]), C.brown);
  ebox(body, [0.58, 0.16, 0.52], at([0, 0.88, 0.08]), C.white);
  ebox(body, [0.48, 0.42, 0.4], at([0, 0.45, -0.3]), C.brown);
  ebox(body, [0.34, 0.1, 0.34], at([0, 0.3, -0.62]), C.tail, -0.5);
  const wings = {};
  for (const s of [-1, 1]) {
    const w = group(body, at([s * 0.31, 0.86, 0.25]));
    ebox(w, [0.07, 0.56, 0.7], [0, -0.28, -0.35], C.wing);
    ebox(w, [0.07, 0.22, 0.3], [s * -0.03, -0.56, -0.73], C.wing);
    wings[s] = w;
  }
  const head = group(body, at([0, 0.9, HEAD_Z]));
  head.rotation.order = 'YXZ';
  ebox(head, [0.46, 0.16, 0.46], [0, 0.02, -0.02], C.white);
  ebox(head, [0.48, 0.42, 0.52], [0, 0.28, 0.04], C.white);
  ebox(head, [0.18, 0.13, 0.28], [0, 0.25, 0.43], C.beak);
  ebox(head, [0.18, 0.18, 0.07], [0, 0.15, 0.58], C.hook);
  for (const s of [-1, 1]) ebox(head, [0.02, 0.08, 0.08], [s * 0.245, 0.33, 0.16], C.eye);
  const jaw = group(head, [0, 0.16, 0.3]);
  ebox(jaw, [0.14, 0.05, 0.22], [0, -0.025, 0.11], C.beak);
  return { root, body, head, jaw, legL: legs[1], legR: legs[-1], wingL: wings[1], wingR: wings[-1] };
}

/** Each frame starts from the rest pose. */
function rest(e) {
  e.root.position.y = 0;
  e.body.position.set(0, HIP, 0);
  e.body.rotation.set(0, 0, 0);
  e.head.position.set(0, 0.9 - HIP, HEAD_Z);
  e.head.rotation.set(0, 0, 0);
  e.jaw.rotation.x = 0;
  for (const p of [e.legL, e.legR, e.wingL, e.wingR]) p.rotation.set(0, 0, 0);
}
function wings(e, a) {
  e.wingL.rotation.z = a;
  e.wingR.rotation.z = -a;
}
/** The game hop in place: crouch 0.09 s, air 0.3 s, land 0.16 s. */
function hop(t) {
  if (t < 0.09) return { y: 0, sy: 1 - 0.2 * ease(t / 0.09) };
  if (t < 0.39) {
    const u = (t - 0.09) / 0.3;
    return { y: 0.42 * 4 * u * (1 - u), sy: 1 + 0.12 * Math.sin(Math.PI * u) };
  }
  const u = clamp01((t - 0.39) / 0.16);
  return { y: 0, sy: 1 - 0.16 * Math.sin(Math.PI * u) };
}
const HOP_TIME = 0.55;

// The R6 run, copied from ../../actions/round2.html: CHARGE, RUNS[2], runPose, and the phases.
const CHARGE = { lean: 0.55, lower: 0.08, headLevel: 0.4, flap: 0, flapHz: 0, smoothBob: true };
export const R6 = { ...CHARGE, wing: 2.0, stepHz: 5, step: 0.9, bob: 0.03, speed: 2.6 };
/**
 * The R6 run at another speed: the same pose, with the stride rate scaled by the same ratio,
 * so the feet do not slide. Opening day uses it at the speed of the traffic car.
 */
export function runAtSpeed(speed) {
  return { ...R6, speed, stepHz: (R6.stepHz * speed) / R6.speed };
}
const RUN_PHASES = { start: 0.25, stop: 0.3 };
function runPose(e, o, k, clock) {
  e.body.rotation.x = k * o.lean;
  e.body.position.y = HIP - k * o.lower;
  e.head.rotation.x = -k * o.lean * o.headLevel;
  const ph = 2 * Math.PI * o.stepHz * clock;
  e.legL.rotation.x = k * o.step * Math.sin(ph);
  e.legR.rotation.x = -k * o.step * Math.sin(ph);
  // Two rises for each stride. The smooth form has no sharp turn at the bottom.
  const rise = o.smoothBob ? (1 - Math.cos(2 * ph)) / 2 : Math.abs(Math.sin(ph));
  e.root.position.y = k * o.bob * rise;
  const tremble = o.flapHz ? o.flap * Math.sin(2 * Math.PI * o.flapHz * clock) : 0;
  wings(e, k * (o.wing + tremble));
  return 1;
}

/** The eagle with a queue of moves. Facing: yaw 0 looks along +z. */
function createEagle(scene) {
  const e = buildEagle();
  scene.add(e.root);
  const s = { x: 0, y: 0, z: 0, yaw: 0, look: null, queue: [], clock: 0 };
  let current = null;

  function run(move) {
    return new Promise((resolve) => {
      s.queue.push({ ...move, t: 0, resolve });
    });
  }

  return {
    root: e.root,
    get x() { return s.x; },
    get z() { return s.z; },
    get yaw() { return s.yaw; },
    get y() { return s.y; },
    place(x, z, yaw, y = 0) {
      s.runD = undefined;
      s.x = x;
      s.y = y;
      s.z = z;
      s.yaw = yaw;
      s.queue.length = 0;
      current = null;
    },
    /** Turn toward a point (a Vector3), or stop watching with null. */
    watch(point) {
      s.look = point;
    },
    hop(count = 1) {
      return run({ kind: 'hop', duration: HOP_TIME * count });
    },
    shake() {
      return run({ kind: 'shake', duration: 0.75 });
    },
    flyTo(x, z, yaw, y = 0) {
      return run({ kind: 'fly', duration: 1.1, x, z, yaw, y });
    },
    /**
     * Run with the R6 run along a path. point(d) gives { x, y, z, h } at distance d.
     * The eagle starts at `from`, speeds up, runs, and slows to a stop at `to`.
     */
    runAlong(point, from, to, o = R6) {
      s.runD = from;
      return run({ kind: 'run', duration: Infinity, point, d: from, to, phase: 'start', pt: 0, o });
    },
    /** True while the eagle runs. */
    get running() {
      return current?.kind === 'run';
    },
    /** The distance along the path of the last run (it stays after the run stops). */
    get runD() {
      return s.runD;
    },
    update(dt) {
      s.clock += dt;
      rest(e);
      if (!current && s.queue.length) {
        current = s.queue.shift();
        if (current.kind === 'fly') Object.assign(current, { fx: s.x, fy: s.y, fz: s.z, fyaw: s.yaw });
      }
      // Turn the body toward the watched point.
      if (s.look && (!current || current.kind !== 'fly')) {
        const want = Math.atan2(s.look.x - s.x, s.look.z - s.z);
        s.yaw = lerpAngle(s.yaw, want, Math.min(1, dt * 5));
      }
      let sy = 1;
      if (current) {
        current.t += dt;
        const t = current.t;
        const u = clamp01(t / current.duration);
        if (current.kind === 'hop') {
          const h = hop(t % HOP_TIME);
          e.root.position.y = h.y;
          sy = h.sy;
          wings(e, 0.5 * Math.sin(Math.PI * clamp01((t % HOP_TIME) / HOP_TIME)));
        } else if (current.kind === 'shake') {
          e.head.rotation.y = 0.45 * Math.sin(6 * Math.PI * u) * (1 - u);
        } else if (current.kind === 'run') {
          // The phases of the trial updateRun: start, run, stop.
          const r = current;
          r.pt += dt;
          let k = 1;
          if (r.phase === 'start') {
            k = ease(r.pt / RUN_PHASES.start);
            if (r.pt >= RUN_PHASES.start) Object.assign(r, { phase: 'run', pt: 0 });
          } else if (r.phase === 'run') {
            if (r.to - r.d <= r.o.speed * 0.15) Object.assign(r, { phase: 'stop', pt: 0 });
          } else {
            k = 1 - ease(r.pt / RUN_PHASES.stop);
          }
          r.d = Math.min(r.to, r.d + r.o.speed * k * dt);
          s.runD = r.d;
          const p = r.point(r.d);
          s.x = p.x;
          s.y = p.y;
          s.z = p.z;
          s.yaw = lerpAngle(s.yaw, Math.PI / 2 - p.h, Math.min(1, dt * 12));
          if (k > 0) runPose(e, r.o, k, s.clock);
          if (r.phase === 'stop') e.body.rotation.x -= 0.2 * Math.sin(Math.PI * clamp01(r.pt / RUN_PHASES.stop));
          if (r.phase === 'stop' && r.pt >= RUN_PHASES.stop) current.t = Infinity;
        } else if (current.kind === 'fly') {
          // A long jump with flaps, like the visit jump of the items trial.
          const k = smooth(u);
          s.x = current.fx + (current.x - current.fx) * k;
          s.y = current.fy + (current.y - current.fy) * k;
          s.z = current.fz + (current.z - current.fz) * k;
          const want = Math.atan2(current.x - current.fx, current.z - current.fz);
          s.yaw = u < 0.2 ? lerpAngle(current.fyaw, want, ease(u / 0.2)) : u < 0.8 ? want : lerpAngle(want, current.yaw, ease((u - 0.8) / 0.2));
          e.root.position.y = 1.2 * 4 * u * (1 - u);
          wings(e, 1.3 + 0.5 * Math.sin(6 * Math.PI * u));
          e.body.rotation.x = 0.25 * Math.sin(Math.PI * u);
        }
        if (current.t >= current.duration) {
          current.resolve();
          current = null;
        }
      }
      // The head looks at the watched point, a little past the body.
      if (s.look && (!current || current.kind !== 'shake')) {
        const want = Math.atan2(s.look.x - s.x, s.look.z - s.z);
        const off = Math.atan2(Math.sin(want - s.yaw), Math.cos(want - s.yaw));
        e.head.rotation.y = Math.max(-0.7, Math.min(0.7, off));
      }
      sy *= 1 + 0.018 * Math.sin(s.clock * 2.3);
      const w = 1 / Math.sqrt(sy);
      e.root.scale.set(w * EAGLE_SIZE, sy * EAGLE_SIZE, w * EAGLE_SIZE);
      e.root.position.x = s.x;
      e.root.position.y += s.y;
      e.root.position.z = s.z;
      e.root.rotation.y = s.yaw;
    },
  };
}

// ---------- Cars ----------

const headlightMat = new THREE.MeshBasicMaterial({ color: '#fff4c2' });

/** A blocky car. It faces +z. The root sits on the road; `body` takes the tilt. */
export function buildCar(color) {
  const root = new THREE.Group();
  const body = group(root, [0, 0, 0]);
  body.rotation.order = 'YXZ';
  box(body, [0.46, 0.16, 0.86], [0, 0.16, 0], color);
  box(body, [0.4, 0.15, 0.46], [0, 0.31, -0.05], '#2b2f36');
  box(body, [0.42, 0.04, 0.44], [0, 0.4, -0.05], color);
  box(body, [0.36, 0.02, 0.14], [0, 0.245, 0.33], '#ffffff');
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) box(body, [0.07, 0.14, 0.15], [sx * 0.235, 0.07, sz * 0.27], '#222326');
    // The headlights do not take light, so they shine at night too.
    box(body, [0.09, 0.05, 0.02], [sx * 0.14, 0.18, 0.435], '#fff4c2').material = headlightMat;
    box(body, [0.09, 0.05, 0.02], [sx * 0.14, 0.18, -0.435], '#c8342f');
  }
  return { root, body };
}

// ---------- Road mesh ----------

const ROAD_TOP = 0.05;
export const ROAD_HALF = 0.62;

/** The road surface height at a lateral offset `l` (toward +p) for a bank angle. */
export function surfaceY(l, bank) {
  return ROAD_TOP + l * Math.sin(bank);
}

/**
 * A road ribbon with side walls, from samples { x, y, z, h, bank }.
 * The walls go down to the ground, or a little under the road on raised ground (the terrain hides the rest).
 * The triangles go in path order, so a draw range can grow the road along its length.
 */
function ribbonGeometry(samples, half, top) {
  const pos = [];
  const corner = (s, side, up) => {
    const px = -Math.sin(s.h);
    const pz = Math.cos(s.h);
    const b = s.bank ?? 0;
    const l = side * half;
    const y = s.y ?? 0;
    return [s.x + px * l * Math.cos(b), up ? y + top + l * Math.sin(b) : Math.max(0, y - 0.3), s.z + pz * l * Math.cos(b)];
  };
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i];
    const c = samples[i + 1];
    const Lt0 = corner(a, -1, true), Rt0 = corner(a, 1, true), Lt1 = corner(c, -1, true), Rt1 = corner(c, 1, true);
    const Lb0 = corner(a, -1, false), Rb0 = corner(a, 1, false), Lb1 = corner(c, -1, false), Rb1 = corner(c, 1, false);
    pos.push(...Lt0, ...Rt0, ...Rt1, ...Lt0, ...Rt1, ...Lt1);
    pos.push(...Lb0, ...Lt0, ...Lt1, ...Lb0, ...Lt1, ...Lb1);
    pos.push(...Rt0, ...Rb0, ...Rb1, ...Rt0, ...Rb1, ...Rt1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const roadMat = new THREE.MeshLambertMaterial({ color: '#9a9ea5', side: THREE.DoubleSide });
/** The ramp deck: a cooler concrete grey, so the ramp reads as one structure. */
const rampMat = new THREE.MeshLambertMaterial({ color: '#8b98ab', side: THREE.DoubleSide });
const barrierMat = new THREE.MeshLambertMaterial({ color: '#e4e1d8' });
const waterMat = new THREE.MeshLambertMaterial({ color: '#8ec5ea', side: THREE.DoubleSide });
const dashGeo = new THREE.BoxGeometry(1, 1, 1);
const dashMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
const edgeMat = new THREE.MeshLambertMaterial({ color: '#eceae4' });

/**
 * The road of one segment: the ribbon, the center dashes, and the edge lines.
 * A ramp piece also gets a low concrete barrier on both edges.
 * Returns { group, reveal(u) }. reveal(0..1) grows the road along the path.
 */
export function roadMesh(samples, { ramp = false } = {}) {
  const g = new THREE.Group();
  const geo = ribbonGeometry(samples, ROAD_HALF, ROAD_TOP);
  const mesh = new THREE.Mesh(geo, ramp ? rampMat : roadMat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  g.add(mesh);
  const total = geo.getAttribute('position').count;

  // Marks: center dashes and both edge lines, as instances.
  const marks = [];
  let dist = 0;
  let nextDash = 0.2;
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const h = Math.atan2(b.z - a.z, b.x - a.x);
    const bank = ((a.bank ?? 0) + (b.bank ?? 0)) / 2;
    const ay = a.y ?? 0;
    const by = b.y ?? 0;
    const my = (ay + by) / 2;
    const pitch = Math.atan2(by - ay, len);
    for (const side of [-1, 1]) {
      const l = side * (ROAD_HALF - 0.07);
      marks.push({ mat: 'edge', x: mx - Math.sin(h) * l * Math.cos(bank), z: mz + Math.cos(h) * l * Math.cos(bank), y: my + surfaceY(l, bank), h, pitch, len: len + 0.02, w: 0.04, t: 0.012, bank, d: dist });
      if (ramp) {
        const lb = side * (ROAD_HALF - 0.01);
        marks.push({ mat: 'barrier', x: mx - Math.sin(h) * lb * Math.cos(bank), z: mz + Math.cos(h) * lb * Math.cos(bank), y: my + surfaceY(lb, bank) + 0.06, h, pitch, len: len + 0.03, w: 0.07, t: 0.14, bank, d: dist });
      }
    }
    while (nextDash < dist + len) {
      const t = (nextDash - dist) / len;
      marks.push({ mat: 'dash', x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: ROAD_TOP + ay + (by - ay) * t, h, pitch, len: 0.3, w: 0.05, t: 0.012, bank, d: nextDash });
      nextDash += 0.7;
    }
    dist += len;
  }
  const lists = { dash: marks.filter((m) => m.mat === 'dash'), edge: marks.filter((m) => m.mat === 'edge'), barrier: marks.filter((m) => m.mat === 'barrier') };
  const MATS = { dash: dashMat, edge: edgeMat, barrier: barrierMat };
  const inst = {};
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const p = new Vector3();
  const s = new Vector3();
  for (const [key, list] of Object.entries(lists)) {
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(dashGeo, MATS[key], list.length);
    list.forEach((m, i) => {
      // Turn the long side along the path, then roll it with the bank (+p side up).
      e.set(-m.bank, -m.h, m.pitch);
      q.setFromEuler(e);
      m4.compose(p.set(m.x, m.y + 0.006, m.z), q, s.set(m.len, m.t, m.w));
      im.setMatrixAt(i, m4);
    });
    im.count = list.length;
    // The reveal starts with 0 instances. A bounds check made then would hide the marks.
    im.frustumCulled = false;
    im.receiveShadow = true;
    im.castShadow = key === 'barrier';
    g.add(im);
    inst[key] = { im, list };
  }
  const length = dist;
  return {
    group: g,
    reveal(u) {
      const k = clamp01(u);
      geo.setDrawRange(0, Math.floor((total / 18) * k) * 18);
      for (const { im, list } of Object.values(inst)) {
        let n = 0;
        while (n < list.length && list[n].d <= length * k) n++;
        im.count = n;
      }
    },
  };
}

/** A flat water ribbon (no walls), slightly below the road top. */
export function waterMesh(samples, half) {
  const pos = [];
  const pt = (s, side) => [s.x - Math.sin(s.h) * side * half, (s.y ?? 0) + 0.012, s.z + Math.cos(s.h) * side * half];
  for (let i = 0; i + 1 < samples.length; i++) {
    const A = pt(samples[i], -1), B = pt(samples[i], 1), Cc = pt(samples[i + 1], 1), D = pt(samples[i + 1], -1);
    pos.push(...A, ...B, ...Cc, ...A, ...Cc, ...D);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, waterMat);
  m.receiveShadow = true;
  return m;
}

/** A mesh from triangles with one color for each triangle (flat, low-poly). */
export function coloredMesh(tris) {
  const pos = [];
  const col = [];
  const c = new THREE.Color();
  for (const [a, b, d, color] of tris) {
    pos.push(...a, ...b, ...d);
    c.set(color);
    for (let i = 0; i < 3; i++) col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A blocky tree. */
export function tree(parent, x, z, size = 1) {
  const g = group(parent, [x, 0, z]);
  g.scale.setScalar(size);
  box(g, [0.14, 0.4, 0.14], [0, 0.2, 0], '#7a5230');
  box(g, [0.56, 0.4, 0.56], [0, 0.55, 0], '#6fae4f');
  box(g, [0.36, 0.3, 0.36], [0, 0.88, 0], '#82c060');
  return g;
}

// ---------- Effects: dust puffs ----------

function createFx(scene) {
  const pool = [];
  const puffMat = new THREE.MeshLambertMaterial({ color: '#e9e3d6', transparent: true, opacity: 0.85, depthWrite: false });
  const live = [];
  return {
    puff(x, y, z, size = 0.18) {
      let m = pool.pop();
      if (!m) {
        m = new THREE.Mesh(unit, puffMat.clone());
        scene.add(m);
      }
      m.visible = true;
      m.position.set(x + (Math.random() - 0.5) * 0.15, y, z + (Math.random() - 0.5) * 0.15);
      m.rotation.set(Math.random(), Math.random(), Math.random());
      live.push({ m, t: 0, size });
    },
    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i];
        p.t += dt;
        const u = p.t / 0.8;
        if (u >= 1) {
          p.m.visible = false;
          pool.push(p.m);
          live.splice(i, 1);
          continue;
        }
        p.m.scale.setScalar(p.size * (0.6 + 1.2 * u));
        p.m.position.y += dt * 0.5;
        p.m.material.opacity = 0.85 * (1 - u);
      }
    },
  };
}

// ---------- World ----------

export function createWorld(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#ffffff');
  const hemi = new THREE.HemisphereLight('#ffffff', '#b8b0a2', 1.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffffff', 1.35);
  const SUN = new Vector3(-3, 10, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 50 });
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.01;
  scene.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.ShadowMaterial({ opacity: 0.13 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 500);
  // The camera turns with the screen shape. The road runs along +x. On a wide screen it goes
  // to the right and a little up. On a tall screen it goes up and a little to the right.
  const azFor = (aspect) => {
    const k = smooth((aspect - 0.8) / 0.4);
    return (-75 + 60 * k) * DEG;
  };
  const cam = { target: new Vector3(), h: 6, az: azFor(innerWidth / innerHeight), goal: null };

  function placeCamera() {
    const d = cam.h / Math.tan((FOV * DEG) / 2);
    camera.position.set(
      cam.target.x + d * Math.cos(EL) * Math.sin(cam.az),
      cam.target.y + d * Math.sin(EL),
      cam.target.z + d * Math.cos(EL) * Math.cos(cam.az),
    );
    camera.lookAt(cam.target);
    camera.aspect = innerWidth / innerHeight;
    camera.near = Math.max(0.5, d - 40);
    camera.far = d + 80;
    camera.updateProjectionMatrix();
    sun.position.copy(cam.target).add(SUN.clone().multiplyScalar(1.6));
    sun.target.position.copy(cam.target);
    ground.position.set(cam.target.x, 0, cam.target.z);
  }

  /**
   * The camera goal for a set of points. `free` is the part of the screen that no panel covers,
   * in px: { left, top, right, bottom }. The points fill that part.
   */
  function frame(points, free, { minH = 3.2, fill = 1.2, pad = 0.7 } = {}) {
    const W = innerWidth;
    const H = innerHeight;
    const aspect = W / H;
    const az = azFor(aspect);
    const R = new Vector3(Math.cos(az), 0, -Math.sin(az));
    const A = new Vector3(-Math.sin(az), 0, -Math.cos(az));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of points) {
      const sx = p.x * R.x + p.z * R.z;
      const sy = (p.x * A.x + p.z * A.z) * Math.sin(EL) + (p.y ?? 0) * Math.cos(EL);
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx);
      y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    // A margin in world units, so the eagle and the road edges stay inside the view.
    x0 -= pad;
    x1 += pad;
    y0 -= pad;
    y1 += pad;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const fl = (free.left / W) * 2 - 1;
    const fr = (free.right / W) * 2 - 1;
    const ft = 1 - (free.top / H) * 2;
    const fb = 1 - (free.bottom / H) * 2;
    const nx = (fl + fr) / 2;
    const ny = (ft + fb) / 2;
    const aw = Math.max(0.15, (fr - fl) / 2);
    const ah = Math.max(0.15, (ft - fb) / 2);
    const h = Math.min(40, Math.max(minH, Math.max((y1 - y0) / 2 / ah, (x1 - x0) / 2 / (aspect * aw)) * fill));
    const center = R.clone().multiplyScalar(cx).addScaledVector(A, cy / Math.sin(EL));
    const target = center.addScaledVector(R, -nx * h * aspect).addScaledVector(A, (-ny * h) / Math.sin(EL));
    cam.goal = { target, h, az };
  }

  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    placeCamera();
  }
  addEventListener('resize', resize);
  resize();

  const eagle = createEagle(scene);
  const fx = createFx(scene);
  const tickers = new Set();

  const timer = new THREE.Timer();
  timer.connect(document);
  let snap = true;
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.05);
    for (const fn of [...tickers]) fn(dt);
    eagle.update(dt);
    fx.update(dt);
    if (cam.goal) {
      const k = snap ? 1 : 1 - Math.exp(-dt * 3);
      cam.target.lerp(cam.goal.target, k);
      cam.h += (cam.goal.h - cam.h) * k;
      cam.az = lerpAngle(cam.az, cam.goal.az, k);
      snap = false;
    }
    placeCamera();
    renderer.render(scene, camera);
  });

  const DAY = { bg: new THREE.Color('#ffffff'), hemi: 1.85, sun: 1.35 };
  const NIGHT = { bg: new THREE.Color('#1d2433'), hemi: 0.32, sun: 0.08 };
  /** Day (0) to night (1). The underpass test drive uses night. */
  function setNight(k) {
    scene.background.copy(DAY.bg).lerp(NIGHT.bg, k);
    hemi.intensity = DAY.hemi + (NIGHT.hemi - DAY.hemi) * k;
    sun.intensity = DAY.sun + (NIGHT.sun - DAY.sun) * k;
  }

  return {
    setNight,
    scene,
    camera,
    eagle,
    fx,
    frame,
    /** Jump the camera to its goal on the next frame. */
    snapCamera() {
      snap = true;
    },
    /** fn(dt) runs every frame until the returned function removes it. */
    tick(fn) {
      tickers.add(fn);
      return () => tickers.delete(fn);
    },
  };
}
