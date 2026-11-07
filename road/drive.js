// The test drive: a blocky car drives the new segment and shows its flaw event.

import * as THREE from 'three';
import { buildCar, box, clamp01 } from './world.js';
import { lanePath, pointAt, distanceOf } from './path.js';
import { STOPPED_COLOR } from './segments.js';

/** Car motion in world units and seconds. */
export const DRIVE = {
  speed: 3.4,
  lane: 0.3,
  /** Half the car length. */
  half: 0.43,
  endBrake: 3,
  reaction: 0.35,
  /** The cut slope: a brake harder than this is a hard brake. The car cannot brake harder than max. */
  calmBrake: 1.8,
  maxBrake: 6,
  /** Stop ahead: the design deceleration. The right SSD stops the car with `gap` to spare. */
  designBrake: 2.6,
  gap: 0.3,
  hold: 0.7,
  maxTime: 14,
  color: '#3f74c9',
};

const UP = new THREE.Vector3(0, 1, 0);

function setPose(car, p, x = {}) {
  car.root.position.set(p.x, p.y + (x.lift ?? 0), p.z);
  car.root.rotation.y = Math.PI / 2 - p.h + (x.yaw ?? 0);
  // A positive pitch puts the nose down, so an upgrade gives a negative pitch.
  car.body.rotation.set(-Math.atan(p.grade ?? 0) + (x.pitch ?? 0), 0, -(p.bank ?? 0) + (x.roll ?? 0));
}

/** The kinds that see a stopped object and brake: the cut slope, the crest, the night sag. */
const SEE = new Set(['cut', 'ridge', 'underpass']);

/** True if the road between two distances rises above the line from the eye to the object. */
function crestBlocks(path, d1, y1, d2, y2) {
  for (const p of path) {
    if (p.d <= d1 || p.d >= d2) continue;
    const ly = y1 + ((y2 - y1) * (p.d - d1)) / (d2 - d1);
    if (p.y > ly) return true;
  }
  return false;
}

/** The pool of light of the headlights: a strip on the road from the car to its reach. */
function lightPool(scene) {
  const N = 14;
  const pos = new Float32Array((N + 1) * 2 * 3);
  const idx = [];
  for (let i = 0; i < N; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#fff1a8', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  m.frustumCulled = false;
  scene.add(m);
  return {
    set(path, from, reach) {
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const p = pointAt(path, from + reach * t);
        const w = 0.12 + 0.26 * t;
        const sx = -Math.sin(p.h) * w;
        const sz = Math.cos(p.h) * w;
        pos.set([p.x - sx, p.y + 0.02, p.z - sz, p.x + sx, p.y + 0.02, p.z + sz], i * 6);
      }
      geo.attributes.position.needsUpdate = true;
    },
    remove() {
      scene.remove(m);
      geo.dispose();
      m.material.dispose();
    },
  };
}

/** A decaying shake: a jolt or a rock. */
function wobble(t, amp, hz, decay) {
  return amp * Math.exp(-decay * t) * Math.sin(2 * Math.PI * hz * t);
}

/** A thin beam between two points (the sightline). */
function beam(scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#c8352b', transparent: true, opacity: 0.7, depthWrite: false }));
  scene.add(m);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  return {
    mesh: m,
    set(p, q, seen) {
      a.set(p.x, p.y, p.z);
      b.set(q.x, q.y, q.z);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.scale.set(0.035, a.distanceTo(b), 0.035);
      m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
      m.material.color.set(seen ? '#2f8a3a' : '#c8352b');
    },
    remove() {
      scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    },
  };
}

/** True if the mound blocks the line from P to Q. */
function blocked(P, Q, c) {
  const dx = Q.x - P.x;
  const dz = Q.z - P.z;
  const len2 = dx * dx + dz * dz || 1;
  const t = clamp01(((c.x - P.x) * dx + (c.z - P.z) * dz) / len2);
  const X = { x: P.x + dx * t, z: P.z + dz * t };
  if (Math.hypot(X.x - c.x, X.z - c.z) >= c.face) return false;
  let a = Math.atan2(X.z - c.z, X.x - c.x);
  while (a < c.a0) a += 2 * Math.PI;
  return a <= c.a1;
}

/**
 * Drive the segment. tail: the last samples of the road before it.
 * Resolves when the car has stopped and the event is over.
 * onEvent(point) runs at the flaw event.
 */
export function testDrive(world, seg, tail, onEvent = () => {}) {
  const d0 = seg.drive;
  const scene = world.scene;
  const car = buildCar(DRIVE.color);
  scene.add(car.root);

  let path;
  if (d0.kind === 'cut' && d0.reverse) {
    // Come from past the end, so the car is on the road when it starts.
    const e = seg.samples[seg.samples.length - 1];
    const beyond = [];
    for (let i = 1; i <= 5; i++) beyond.push({ x: e.x + Math.cos(e.h) * 0.3 * i, y: e.y ?? 0, z: e.z + Math.sin(e.h) * 0.3 * i, h: e.h, bank: 0 });
    path = lanePath(seg.samples.concat(beyond), DRIVE.lane, true);
  } else {
    path = lanePath(tail.concat(seg.samples), DRIVE.lane);
  }
  const L = path[path.length - 1].d;
  const vmax = d0.speed ?? DRIVE.speed;
  const st = { d: 0, v: vmax, t: 0, mode: 'drive', hold: 0, fx: {} };
  const extra = { lift: 0, roll: 0, pitch: 0, yaw: 0 };
  const cleanups = [];
  let evented = false;
  const event = (p) => {
    if (evented) return;
    evented = true;
    onEvent(p);
  };

  // Type data.
  const kinkD = d0.kind === 'river' ? d0.kinks.map((k) => distanceOf(path, k.x, k.z)) : [];
  const jolts = [];
  let skid = null;
  let other = null;
  let sight = null;
  let stopD = L - 0.25;
  let brake = null;
  if (d0.kind === 'fast' && d0.flaw) {
    const a = distanceOf(path, d0.arcStart.x, d0.arcStart.z);
    const b = distanceOf(path, d0.arcEnd.x, d0.arcEnd.z);
    st.departAt = a + (b - a) * (0.35 - 0.25 * d0.s);
  }
  if (SEE.has(d0.kind)) {
    const ds = distanceOf(path, d0.stopped.x, d0.stopped.z);
    // A stopped car (the cut slope, the crest) or fallen debris (the night sag).
    st.otherHalf = d0.kind === 'underpass' ? 0.2 : DRIVE.half;
    if (d0.kind !== 'underpass') {
      other = buildCar(STOPPED_COLOR);
      scene.add(other.root);
      setPose(other, pointAt(path, ds));
      sight = beam(scene);
      cleanups.push(() => sight.remove());
    } else {
      st.pool = lightPool(scene);
      cleanups.push(() => st.pool.remove());
      d0.lit?.(false);
      // A replay (opening day) puts the cleared debris back.
      d0.debris.visible = true;
      d0.debris.scale.setScalar(1);
    }
    st.otherD = ds;
    stopD = ds - st.otherHalf - DRIVE.half - DRIVE.gap;
  }
  const trans = d0.kind === 'bank' ? d0.transitions.map(([a, b]) => [distanceOf(path, a.x, a.z), distanceOf(path, b.x, b.z)]) : [];
  const rocks = [];
  if (d0.kind === 'stop') {
    // A replay (opening day) puts the cleared rocks back first.
    d0.rocks.visible = true;
    d0.rocks.scale.setScalar(1);
    for (const m of d0.parts) {
      m.position.copy(m.userData.home.p);
      m.rotation.copy(m.userData.home.r);
    }
    st.signD = distanceOf(path, d0.sign.x, d0.sign.z);
    st.hazardD = distanceOf(path, d0.hazard.x, d0.hazard.z);
    // The rocks are about 0.2 deep: the car touches them at this distance.
    st.touchD = st.hazardD - DRIVE.half - 0.22;
  }

  /** Two thin tire marks behind the car, one for each rear wheel. */
  function skidMark(x, z, h, y) {
    for (const side of [-1, 1]) {
      const mx = x - Math.cos(h) * 0.27 - Math.sin(h) * side * 0.2;
      const mz = z - Math.sin(h) * 0.27 + Math.cos(h) * side * 0.2;
      const m = box(seg.group, [0.045, 0.004, 0.15], [mx, y + 0.004, mz], '#4a4c50');
      m.rotation.y = Math.PI / 2 - h;
      m.castShadow = false;
    }
  }
  function dust(x, z, n = 1, y = d0.ground ?? 0) {
    for (let i = 0; i < n; i++) world.fx.puff(x, y + 0.1, z, 0.14 + Math.random() * 0.08);
  }

  world.eagle.watch(car.root.position);

  return new Promise((resolve) => {
    let markT = 0;
    const stop = world.tick((dt) => {
      st.t += dt;
      // markT: the distance since the last tire mark.
      extra.lift = 0;
      extra.roll = 0;
      extra.pitch = 0;
      let p;

      if (st.mode === 'skid') {
        // Off the road: slide on, spin, and slow down.
        skid.v = Math.max(0, skid.v - 2.6 * dt);
        skid.x += Math.cos(skid.h) * skid.v * dt;
        skid.z += Math.sin(skid.h) * skid.v * dt;
        skid.yaw += skid.spin * (skid.v / DRIVE.speed) * dt;
        skid.y = Math.max(d0.ground ?? 0, skid.y - dt * 0.2);
        p = { x: skid.x, y: skid.y, z: skid.z, h: skid.h, bank: 0 };
        extra.yaw = skid.yaw;
        extra.roll = -0.12 * Math.sign(skid.spin) * (skid.v / DRIVE.speed);
        markT += skid.v * dt;
        if (skid.v > 0.2 && markT > 0.13) {
          markT = 0;
          dust(skid.x, skid.z, 1, skid.y);
          skidMark(skid.x, skid.z, skid.h, skid.y);
        }
        if (skid.v <= 0) st.mode = 'done';
      } else {
        // On the road.
        let a = 0;
        if (SEE.has(d0.kind)) {
          const me = pointAt(path, st.d);
          const eye = { x: me.x + Math.cos(me.h) * 0.3, y: me.y + 0.27, z: me.z + Math.sin(me.h) * 0.3 };
          const op = pointAt(path, st.otherD - st.otherHalf);
          const target = { x: op.x, y: op.y + 0.25, z: op.z };
          let seen = true;
          if (st.mode === 'drive') {
            if (d0.kind === 'cut') seen = !blocked(eye, op, d0.circle);
            else if (d0.kind === 'ridge') seen = !crestBlocks(path, st.d + 0.3, eye.y, st.otherD - st.otherHalf, op.y + 0.2);
            else seen = op.d - (st.d + DRIVE.half) <= d0.reach;
          }
          if (sight) sight.set(eye, target, seen);
          if (st.pool) {
            world.setNight(Math.min(1, st.t / 0.5));
            st.pool.set(path, st.d + DRIVE.half, d0.reach);
          }
          if (st.mode === 'drive' && seen) {
            d0.lit?.(true);
            const room = stopD - st.d - st.v * DRIVE.reaction;
            const need = room > 0.02 ? (st.v * st.v) / (2 * room) : Infinity;
            brake = { at: st.t + DRIVE.reaction, a: Math.min(DRIVE.maxBrake, need), hard: seg.flaw || need > DRIVE.calmBrake };
            st.mode = 'react';
          }
        }
        if (d0.kind === 'stop' && st.mode === 'drive' && st.d + DRIVE.half >= st.signD) {
          // The driver sees the hazard at the start of the cleared zone and stops with the right
          // values: a reaction distance, then a braking distance. The front stops at the end of the right zone.
          const react = d0.react ?? st.v * DRIVE.reaction;
          const brakeLen = d0.brake ?? (st.v * st.v) / (2 * DRIVE.designBrake);
          brake = { atD: st.d + react, a: (st.v * st.v) / (2 * Math.max(0.2, brakeLen)), hard: false };
          st.mode = 'react';
        }
        if (brake && (brake.atD !== undefined ? st.d >= brake.atD : st.t >= brake.at)) {
          st.mode = 'brake';
          a = brake.a;
          extra.pitch = 0.05 + 0.02 * a;
          markT += st.v * dt;
          if (brake.hard && st.v > 0.2 && markT > 0.13) {
            markT = 0;
            const me = pointAt(path, st.d);
            skidMark(me.x, me.z, me.h, me.y);
            dust(me.x, me.z, 1, me.y);
            if (!evented) event(me);
          }
        }
        // A gentle stop at the end of the path.
        if (!brake) {
          const left = stopD - st.d;
          if (left < (st.v * st.v) / (2 * DRIVE.endBrake) + 0.01) a = DRIVE.endBrake;
          else if (st.v < vmax) a = -2;
        }
        st.v = Math.min(vmax, Math.max(0, st.v - a * dt));
        st.d += st.v * dt;

        // Hit the stopped car or the rocks.
        if (SEE.has(d0.kind) && st.d >= st.otherD - st.otherHalf - DRIVE.half) {
          const hit = st.v;
          st.d = st.otherD - st.otherHalf - DRIVE.half;
          st.v = 0;
          if (hit > 0.05) {
            jolts.push({ t: st.t, amp: 0.08 + 0.06 * hit, hz: 7, decay: 6 });
            if (other) {
              st.otherD += 0.25 * hit;
              setPose(other, pointAt(path, st.otherD));
            }
            const me = pointAt(path, st.d);
            dust(me.x + Math.cos(me.h) * 0.4, me.z + Math.sin(me.h) * 0.4, 4, me.y);
            event(me);
          }
        }
        if (d0.kind === 'stop' && st.d >= st.touchD) {
          const hit = st.v;
          st.d = st.touchD;
          st.v = 0;
          if (hit > 0.02) {
            jolts.push({ t: st.t, amp: 0.06 + 0.08 * hit, hz: 7, decay: 6 });
            const me = pointAt(path, st.d);
            dust(d0.hazard.x, d0.hazard.z, 5, me.y);
            scatter(d0, me.h, hit, rocks);
            event(d0.hazard);
          }
        }
        if (st.v <= 0 && st.mode !== 'done' && (brake || st.d >= stopD - 0.05)) st.mode = 'done';

        p = pointAt(path, st.d);

        // River bend: a jolt at each kink.
        for (let i = 0; i < kinkD.length; i++) {
          if (kinkD[i] !== null && st.d >= kinkD[i]) {
            kinkD[i] = null;
            jolts.push({ t: st.t, amp: 0.12 + 0.22 * d0.s, hz: 4.5, decay: 4.5 });
            st.v *= 0.7;
            dust(p.x, p.z, 3, p.y);
            event(p);
          }
        }
        // Banked bend: the car rocks when the bank changes too fast.
        if (d0.kind === 'bank' && d0.flaw) {
          for (const tr of trans) {
            if (!tr.hit && st.d >= tr[0]) {
              tr.hit = true;
              jolts.push({ t: st.t, amp: 0.06 + 0.24 * d0.s, hz: 2.4, decay: 1.6, roll: true });
              event(p);
            }
          }
        }
        // Fast bend: the car leaves the road.
        if (st.departAt !== undefined && st.d >= st.departAt) {
          const turn = d0.turn;
          skid = { x: p.x, z: p.z, y: p.y, h: p.h - turn * 0.12, v: st.v, yaw: 0, spin: -turn * (1.6 + 2.6 * d0.s) };
          st.mode = 'skid';
          event(p);
        }
      }

      for (const j of jolts) {
        const t = st.t - j.t;
        extra.roll += wobble(t, j.amp, j.hz, j.decay);
        if (!j.roll) {
          extra.lift += Math.abs(wobble(t, j.amp * 0.6, j.hz * 0.8, j.decay * 1.3));
          extra.pitch += wobble(t + 0.05, j.amp * 0.5, j.hz, j.decay);
        }
      }
      setPose(car, p, extra);
      updateRocks(rocks, dt, d0.ground ?? 0);

      if (st.mode === 'done') st.hold += dt;
      if (st.hold >= DRIVE.hold || st.t > DRIVE.maxTime) {
        stop();
        finish();
      }
    });

    function finish() {
      world.eagle.watch(null);
      for (const c of cleanups) c();
      const parts = [car.root, other?.root].filter(Boolean);
      // The crew clears the rocks or the debris after the drive.
      const clearGroup = d0.kind === 'stop' ? d0.rocks : (d0.debris ?? null);
      const night = d0.kind === 'underpass';
      let t = 0;
      // The cars and the hazard shrink away. A night drive turns back to day.
      const off = world.tick((dt) => {
        t += dt;
        const k = 1 - clamp01(t / 0.45);
        for (const r of parts) r.scale.setScalar(Math.max(0.001, k));
        if (clearGroup) clearGroup.scale.setScalar(Math.max(0.001, k));
        if (night) world.setNight(k);
        if (t >= 0.45) {
          off();
          for (const r of parts) scene.remove(r);
          if (clearGroup) clearGroup.visible = false;
          if (night) d0.lit?.(false);
          resolve();
        }
      });
    }
  });
}

/** The rocks fly forward when the car hits them. */
function scatter(d0, h, hit, out) {
  for (const m of d0.parts) {
    out.push({
      m,
      vx: Math.cos(h) * (0.6 + Math.random()) * hit * 0.6,
      vz: Math.sin(h) * (0.6 + Math.random()) * hit * 0.6 + (Math.random() - 0.5) * 0.4,
      vy: 0.8 + Math.random() * 0.8,
      spin: (Math.random() - 0.5) * 8,
      local: true,
    });
  }
}

function updateRocks(list, dt, ground) {
  for (const r of list) {
    if (r.done) continue;
    // The rocks group turns with the road, so move in world space through the parent.
    const parent = r.m.parent;
    const w = r.m.getWorldPosition(new THREE.Vector3());
    w.x += r.vx * dt;
    w.z += r.vz * dt;
    w.y += r.vy * dt;
    r.vy -= 9 * dt;
    const floor = ground + 0.05 + r.m.scale.y / 2;
    if (w.y <= floor) {
      w.y = floor;
      r.vy = 0;
      r.vx *= 0.8;
      r.vz *= 0.8;
      if (Math.abs(r.vx) + Math.abs(r.vz) < 0.05) r.done = true;
    }
    r.m.position.copy(parent.worldToLocal(w));
    r.m.rotation.x += r.spin * dt;
    r.spin *= 0.97;
  }
}

/**
 * Traffic on opening day: a car in the right lane that keeps a fixed gap behind a leader.
 * leaderD() gives the distance of the leader (the eagle) along the same road. The car moves only
 * when the leader moves, and waits when the leader waits. Returns { car, remove() }.
 */
export function follower(world, samples, leaderD, gap, color = '#7a4fe0') {
  const car = buildCar(color);
  world.scene.add(car.root);
  const path = lanePath(samples, DRIVE.lane);
  const off = world.tick(() => {
    setPose(car, pointAt(path, Math.max(0, leaderD() - gap)));
  });
  return {
    car,
    remove() {
      off();
      world.scene.remove(car.root);
    },
  };
}
