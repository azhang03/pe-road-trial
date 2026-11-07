// M2, the road builder, round 2a. The answers build a road. A test car drives each new piece
// before the card shows the solution. Flaws stay in the road until a rework, and opening day
// charges a claim for each flaw that is left.
// The brief: ../BRIEF.md, "M2: road builder". All money is in thousands of dollars ($k).

import * as THREE from 'three';
import { createRandom } from '../shared/rng.js';
import { TIME_LIMITS, GENERATORS, makeElite } from '../shared/questions.js';
import { askQuestion } from '../shared/card.js';
import { createStore } from '../shared/store.js';
import { createWorld, box, group, clamp01, roadMesh, runAtSpeed } from './world.js';
import { TYPES, TYPE_BY_ID, GEOMETRY, ASKS, segmentQuestion, reworkQuestion, buildPiece, planRamp, addRampSign, at } from './segments.js';
import { testDrive, follower } from './drive.js';
import { pathFrom, lanePath, pointAt, distanceOf } from './path.js';
import { ITEM_IDS, ITEM_NAME } from './items.js';
import { el, button, money, renderHud, itemCard } from './hud.js';

/** The run rules (BRIEF, "Run rules" and "M2"). First guesses: tune them here. */
export const RULES = {
  startBudget: 1000, // start budget, and the top for the site office. At 0 or less, the run ends.
  damage: { quick: 60, step: 100, full: 150 }, // budget lost for a wrong answer
  lateFee: 20, // liquidated damages for each started period past the limit
  latePeriod: 30, // seconds
  fee: { quick: 20, step: 40, full: 60 }, // fee for a right answer
  fastBonus: 1.5, // fee times 1.5 if the answer took less than fastShare of the limit
  fastShare: 0.5,
  numberShare: 0.5, // step and full questions: the share asked with a number field
  stages: 2, // stage 1 on the flat, stage 2 in the hills
  stageLength: 8, // road segments in each stage (a ramp counts as one)
  stage2: { verticalShare: 2 / 3 }, // stage 2 cards: vertical types 2 times in 3, else horizontal review
  offerMin: 2, // cards for each step (both ends included)
  offerMax: 3,
  stakeConceptShare: 0.5, // the survey stake asks a concept question this often, else H1
  offer: {
    specialFrom: 2, // no ramp, supplier, or site office in the first 2 steps
    // The weight of each card kind after that. Each special kind shows at most once in an offer.
    mix: { road: 0.66, ramp: 0.14, supplier: 0.12, office: 0.08 },
    last: ['supplier', 'office'], // the step before opening day
  },
  elite: { fee: 1.5, offers: 2 }, // the ramp: fee times 1.5, then pick 1 of 2 items
  office: { budget: 250 },
  supplier: { offers: 3, rework: 60 }, // rework costs $60k fee
  claim: 150, // opening day: the claim for each flaw that is left
  // Opening day: the eagle and the traffic car share this speed (world units a second).
  // The car keeps `gap` behind the eagle. `pause`: ms after each claim.
  opening: { speed: 6, gap: 1.8, pause: 400 },
  price: { bookmark: 100, secondOpinion: 120, changeOrder: 150, contingency: 120, valueEngineering: 80, overtime: 80 },
  valueEngineering: 0.2, // fee share for each copy
  overtime: 30, // seconds for each copy on each time limit
};

// ---------- URL options ----------

const params = new URLSearchParams(location.search);
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const feeParam = Number.parseFloat(params.get('fee') ?? '');
const OPTS = {
  seed: Number.isFinite(seedParam) ? seedParam : null,
  stage: params.get('stage') === '2' ? 2 : 1,
  fresh: params.has('fresh'),
  reveal: params.has('reveal'),
  notimer: params.has('notimer'),
  exam: params.has('exam'),
  debug: params.has('debug'),
  fee: Number.isFinite(feeParam) && feeParam > 0 ? Math.round(feeParam) : 0, // debug: start fee in $k
  items: parseItems(params.get('items')), // debug: start items, for example ?items=bookmark,overtime
  // Debug: ?segments=H5,ramp,supplier puts that card first in each step, in order.
  steps: (params.get('segments') ?? '').split(',').filter(Boolean).map(stepOfKey).filter(Boolean),
};

/** "bookmark,bookmark,overtime" gives { bookmark: 2, overtime: 1 }. Unknown ids are left out. */
function parseItems(text) {
  const out = {};
  for (const id of (text ?? '').split(',')) {
    if (ITEM_IDS.includes(id)) out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

/**
 * A step from a ?segments key: a type id, a generator id, ramp, supplier, or office.
 * A type id can name the ask too, for example river:T, building:LC, or stop:braking.
 */
function stepOfKey(key) {
  const [k, ask = null] = key.trim().split(':');
  if (['ramp', 'supplier', 'office'].includes(k.toLowerCase())) return { kind: k.toLowerCase() };
  if (TYPE_BY_ID[k.toLowerCase()]) return { kind: 'road', type: TYPE_BY_ID[k.toLowerCase()], ask };
  const up = k.toUpperCase();
  if (up === 'C' || up === 'H1') return { kind: 'road', type: TYPE_BY_ID.stake, gen: up };
  const t = TYPES.find((x) => x.gen === up);
  return t ? { kind: 'road', type: t, ask } : null;
}

const store = createStore('m2');
const $ = (id) => document.getElementById(id);
const GEN_TITLE = Object.fromEntries(GENERATORS.map((g) => [g.id, g.title]));
GEN_TITLE.C = 'Concept';
/** "Kink at the PC" gives "kink at the PC". */
const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- World ----------

const world = createWorld($('scene'));
let rng;
let run;
let mode = 'offer';
let camPiece = null; // the piece that the camera shows in 'drive' and 'banner'
let openingFocus = null; // the piece of an opening day event
let openingCar = null; // the traffic car of opening day
let peek = null; // a short camera look at a flaw: { points, until }
let openKey = null; // the open HUD info: an item id, 'flaws', or null
let currentQuestion = null;

/** The yaw that faces along heading h (the eagle faces +z). */
const yawOf = (h) => Math.PI / 2 - h;
const along = (p, d, side = 0) => at(p.x, p.z, p.h, d, side);

/** The eagle stands beside the end of the road, on the left. */
function eagleSpot(end) {
  return { ...along(end, -0.3, -1.1), y: end.y ?? 0 };
}

/** The red ring at a flaw event. */
const marker = (() => {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.56, 32),
    new THREE.MeshBasicMaterial({ color: '#c8352b', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
  );
  m.rotation.x = -Math.PI / 2;
  m.visible = false;
  world.scene.add(m);
  let t = 0;
  world.tick((dt) => {
    if (!m.visible) return;
    t += dt;
    m.scale.setScalar(1 + 0.18 * Math.sin(t * 6));
  });
  return {
    show(p) {
      m.position.set(p.x, (p.y ?? 0) + 0.09, p.z);
      m.visible = true;
    },
    hide() {
      m.visible = false;
    },
  };
})();

// ---------- Items ----------

const copies = (id) => run.items[id] ?? 0;
const usesLeft = (id) => copies(id) - (run.used[id] ?? 0);

/** The time limit for a kind, with Overtime. null with ?notimer. */
function limitFor(kind) {
  if (OPTS.notimer) return null;
  return (OPTS.exam ? TIME_LIMITS.exam : TIME_LIMITS[kind]) + RULES.overtime * copies('overtime');
}

// ---------- Camera framing ----------

/** The part of the screen that the panels do not cover, in px. */
function freeRect() {
  const W = innerWidth;
  const H = innerHeight;
  const free = { left: 0, top: $('hud').getBoundingClientRect().bottom + 8, right: W, bottom: H };
  for (const node of [$('offer'), $('q-host'), $('banner'), $('panel'), $('claims')]) {
    if (node.hidden || !node.firstElementChild) continue;
    const r = node.getBoundingClientRect();
    if (r.height < 1) continue;
    if (r.left > W * 0.3 && r.right > W - 40) free.right = Math.min(free.right, r.left - 8);
    else if (r.bottom > H - 40) free.bottom = Math.min(free.bottom, r.top - 8);
  }
  if (free.bottom - free.top < H * 0.2) free.bottom = free.top + H * 0.2;
  return free;
}

function sampleEvery(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list[i]);
  if (list.length) out.push(list[list.length - 1]);
  return out;
}

/** Points around the eagle, so the whole bird stays in view. */
function eaglePoints(p) {
  const y = p.y ?? 0;
  return [p, { x: p.x + 0.5, y, z: p.z }, { x: p.x - 0.5, y, z: p.z }, { x: p.x, y, z: p.z + 0.5 }, { x: p.x, y, z: p.z - 0.5 }, { ...p, y: y + 1.1 }];
}

function cameraPoints() {
  if (peek && performance.now() < peek.until) return peek.points;
  const eg = { x: world.eagle.x, y: world.eagle.y, z: world.eagle.z };
  if (mode === 'summary') return sampleEvery(run.road, 6);
  if (mode === 'opening') {
    // The eagle and the traffic car stay in view together.
    const car = openingCar ? [{ x: openingCar.root.position.x, y: openingCar.root.position.y, z: openingCar.root.position.z }] : [];
    if (openingFocus) return [...sampleEvery(openingFocus.samples, 3), ...eaglePoints(eg), ...car];
    const f = { x: Math.sin(world.eagle.yaw), z: Math.cos(world.eagle.yaw) };
    return [...eaglePoints(eg), ...car, { x: eg.x + f.x * 3, y: eg.y, z: eg.z + f.z * 3 }];
  }
  if ((mode === 'drive' || mode === 'banner' || mode === 'solution') && camPiece) {
    // The eagle stays in view only when it is near the piece (a rework can be far back).
    const s0 = camPiece.samples[0];
    const near = Math.hypot(eg.x - s0.x, eg.z - s0.z) < 8;
    return [...sampleEvery(camPiece.samples, 3), ...(near ? eaglePoints(eg) : [])];
  }
  // offer, question, panel: the road end, a little road behind it, the space ahead, and the eagle.
  const end = run.end;
  const behind = run.road.slice(-12);
  const y = end.y ?? 0;
  return [...sampleEvery(behind, 3), { ...along(end, 3.5, -1.2), y }, { ...along(end, 3.5, 1.2), y }, ...eaglePoints(eg)];
}

world.tick(() => {
  if (!run) return;
  world.frame(cameraPoints(), freeRect(), { minH: 3.6, fill: 1.08, pad: 0.6 });
  // Flat zone labels turn with the camera, so their text reads the right way up.
  const d = world.camera.getWorldDirection(camDir);
  const az = Math.atan2(-d.x, -d.z);
  for (const p of run.pieces) for (const l of p.camLabels ?? []) l.rotation.y = az;
});
const camDir = new THREE.Vector3();

function setMode(next, piece = null) {
  mode = next;
  if (piece) camPiece = piece;
  peek = null;
}

// ---------- HUD ----------

function flaws() {
  return run.pieces.filter((p) => p.flaw);
}

/** The flaws that a rework can still help: a flaw with a claim paid is not in the list. */
function reworkable() {
  return run.pieces.filter((p) => p.flaw && !p.claimed);
}

function refreshHud() {
  renderHud($('hud'), {
    run,
    rules: { ...RULES, stageLength: RULES.stageLength },
    open: openKey,
    copies,
    usesLeft,
    flaws: flaws(),
    onToggle(key) {
      openKey = openKey === key ? null : key;
      refreshHud();
    },
    onFlaw(piece) {
      const p = piece.flawAt;
      peek = { points: [...sampleEvery(piece.samples, 3), { x: p.x + 1.5, z: p.z + 1.5 }, { x: p.x - 1.5, z: p.z - 1.5 }], until: performance.now() + 4000 };
      marker.show(p);
      setTimeout(() => {
        if (!peek) marker.hide();
      }, 4100);
    },
  });
}

function toast(text, tone) {
  const t = el('span', `toast ${tone}`, text);
  $('toasts').style.top = `${$('hud').getBoundingClientRect().bottom + 4}px`;
  $('toasts').append(t);
  setTimeout(() => t.remove(), 2200);
}

// ---------- The run ----------

function clearScene() {
  if (!run) return;
  for (const p of run.pieces) world.scene.remove(p.group);
  for (const g of run.extras) world.scene.remove(g);
}

/** The run state without the scene. */
function freshState() {
  return {
    seed: OPTS.seed ?? Math.floor(Math.random() * 1e9),
    stage: 1,
    phase: 'build', // 'build' or 'opening'
    budget: RULES.startBudget,
    fee: OPTS.fee,
    built: 0,
    steps: 0,
    stats: {}, // the whole run
    stageStats: {}, // { [stage]: { [gen]: { right, wrong } } }
    items: { ...OPTS.items },
    used: { secondOpinion: 0, changeOrder: 0, contingency: 0 },
    order: 0,
    forced: 0,
    flawsBuilt: 0,
    earth: 0,
    reworked: 0,
    claims: [],
    cleared: 0,
    end: null,
    offices: [],
  };
}

/** Set up the scene for a state: the start straight, the barrier, and the eagle. */
function setupScene(state) {
  clearScene();
  run = { ...state, pieces: [], extras: [], road: [] };
  rng = createRandom(run.seed);
  // The start: a short straight with a barrier.
  const p = pathFrom(-3, 0, 0);
  p.straight(3);
  run.stub = p.pts;
  const g = new THREE.Group();
  g.add(roadMesh(p.pts).group);
  const bar = group(g, [-3.2, 0, 0]);
  bar.rotation.y = Math.PI / 2;
  for (let i = 0; i < 4; i++) box(bar, [0.3, 0.12, 0.06], [-0.45 + i * 0.3, 0.42, 0], i % 2 ? '#ffffff' : '#ff7a1a');
  box(bar, [0.05, 0.42, 0.05], [-0.55, 0.21, 0], '#8a8f96');
  box(bar, [0.05, 0.42, 0.05], [0.55, 0.21, 0], '#8a8f96');
  world.scene.add(g);
  run.extras.push(g);
  rebuildRoad();
  const e = p.last();
  if (!run.end) run.end = { x: e.x, y: 0, z: e.z, h: e.h };
  $('summary').hidden = true;
  $('claims').hidden = true;
  $('claims').replaceChildren();
  openKey = null;
}

function placeEagleAtEnd() {
  const eg = eagleSpot(run.end);
  world.eagle.place(eg.x, eg.z, yawOf(run.end.h) - 0.6, eg.y);
}

async function newRun() {
  setupScene(freshState());
  placeEagleAtEnd();
  // ?stage=2 starts at stage 2 with the short straight road.
  if (OPTS.stage === 2) await startStage(2);
  refreshHud();
  setMode('offer');
  world.snapCamera();
  saveRun();
  play();
}

/** Continue a saved run: rebuild each piece from its saved answer, in road order. */
function continueRun(saved) {
  const { pieces, ...state } = saved;
  setupScene(state);
  for (const spec of [...pieces].sort((a, b) => a.order - b.order)) {
    const piece = place(spec);
    world.scene.add(piece.group);
    piece.road.reveal(1);
    // The crew cleared the hazards after the first test drive.
    if (piece.drive?.rocks) piece.drive.rocks.visible = false;
    if (piece.drive?.debris) piece.drive.debris.visible = false;
  }
  for (const o of run.offices) officeModel(o);
  placeEagleAtEnd();
  refreshHud();
  setMode('offer');
  world.snapCamera();
  if (run.phase === 'opening') openingDay();
  else play();
}

/** The road samples in road order: the start, then each built piece. */
function rebuildRoad() {
  run.pieces.sort((a, b) => a.order - b.order);
  run.road = [...run.stub];
  for (const p of run.pieces) run.road.push(...p.samples.slice(1));
}

/** clear(x, z, r): true if no road (but `skip`) and not the eagle is within r of the point. */
function clearFor(skip) {
  const samples = [...run.stub, ...run.pieces.filter((p) => p !== skip).flatMap((p) => p.samples)];
  const eg = eagleSpot(run.end);
  return (x, z, r) => samples.every((s) => Math.hypot(s.x - x, s.z - z) >= r) && Math.hypot(eg.x - x, eg.z - z) >= 1;
}

/** A right turn (+1) or a left turn (-1). Bends turn back toward the main direction (+x). */
function turnSign(h) {
  if (h > 0.05) return -1;
  if (h < -0.05) return 1;
  return rng.chance(0.5) ? 1 : -1;
}

/** The road samples just before a piece, about `len` long. A gap gives a straight line back. */
function tailBefore(piece, len = 1.6) {
  const before = [...run.stub];
  for (const p of run.pieces) {
    if (p.order >= piece.order) break;
    before.push(...p.samples.slice(1));
  }
  const s = piece.samples[0];
  const last = before[before.length - 1];
  if (!last || Math.hypot(last.x - s.x, last.z - s.z) > 0.05) {
    const out = [];
    for (let i = 5; i >= 1; i--) out.push({ x: s.x - Math.cos(s.h) * 0.32 * i, y: s.y ?? 0, z: s.z - Math.sin(s.h) * 0.32 * i, h: s.h, bank: 0 });
    return out;
  }
  const out = [];
  let d = 0;
  for (let i = before.length - 2; i >= 0 && d < len; i--) {
    const a = before[i];
    const b = before[i + 1];
    d += Math.hypot(b.x - a.x, b.z - a.z);
    out.unshift(a);
  }
  return out;
}

/** Build a piece, add it to the run and the scene (not shown yet). */
function place(spec) {
  const piece = buildPiece(spec, clearFor(null));
  for (const which of spec.signs ?? []) addRampSign(piece, which);
  run.pieces.push(piece);
  rebuildRoad();
  clearDecor(piece);
  return piece;
}

/** Hide older trees and piles that the new road runs over. */
function clearDecor(piece) {
  for (const s of run.pieces) {
    if (s === piece) continue;
    for (const o of s.pops) {
      if (!o.userData.decor) continue;
      const p = o.position;
      if (piece.samples.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1.3)) o.visible = false;
    }
  }
}

/** Grow the road along its length, then pop up the extras. */
function reveal(piece) {
  world.scene.add(piece.group);
  piece.road.reveal(0);
  const base = piece.pops.map((o) => o.scale.clone());
  for (const o of piece.pops) {
    if (o.userData.grow === 'y') o.scale.y = 0.001;
    else o.scale.setScalar(0.001);
  }
  let t = 0;
  return new Promise((resolve) => {
    const off = world.tick((dt) => {
      t += dt;
      piece.road.reveal(t / 0.7);
      piece.pops.forEach((o, i) => {
        const u = clamp01((t - 0.45 - i * 0.05) / 0.3);
        // A small overshoot, so the parts pop.
        const k = Math.max(0.001, 1 + 2.7 * (u - 1) ** 3 + 1.7 * (u - 1) ** 2);
        if (o.userData.grow === 'y') o.scale.y = base[i].y * k;
        else o.scale.copy(base[i]).multiplyScalar(k);
      });
      if (t >= 0.75 + piece.pops.length * 0.05) {
        off();
        resolve();
      }
    });
  });
}

// ---------- Answers and money ----------

/**
 * Apply one answer to the run (the M1 rules). Returns the money lines for the banner.
 * opts: { kind, limit, feeTimes, feeNote }.
 */
function settle(q, res, { kind, limit, feeTimes = 1, feeNote = '' }) {
  const lines = [];
  if (res.usedSecondOpinion) {
    run.used.secondOpinion += 1;
    lines.push({ text: 'Second Opinion used', tone: 'note' });
  }
  if (res.skipped) {
    // A Change Order skip costs nothing and earns nothing. It does not count as an answer.
    run.used.changeOrder += 1;
    lines.push({ text: 'Change Order: no cost', tone: 'note' });
    refreshHud();
    return lines;
  }
  if (res.correct) {
    const fast = limit !== null && res.elapsed < limit * RULES.fastShare;
    const ve = 1 + RULES.valueEngineering * copies('valueEngineering');
    const fee = Math.round(RULES.fee[kind] * feeTimes * (fast ? RULES.fastBonus : 1) * ve);
    if (fee > 0) {
      run.fee += fee;
      lines.push({ text: `+${money(fee)} fee`, tone: 'up' });
      toast(`+${money(fee)} fee`, 'up');
      if (feeNote) lines.push({ text: feeNote, tone: 'note' });
      if (fast) lines.push({ text: `fast \u00d7${RULES.fastBonus}`, tone: 'note' });
      if (ve > 1) lines.push({ text: `Value Eng. +${Math.round((ve - 1) * 100)}%`, tone: 'note' });
    }
  } else if (usesLeft('contingency') > 0) {
    run.used.contingency += 1;
    lines.push({ text: 'Contingency: no damage', tone: 'note' });
  } else {
    const damage = RULES.damage[kind];
    run.budget -= damage;
    lines.push({ text: `${money(-damage)} damage`, tone: 'down' });
    toast(`${money(-damage)}`, 'down');
  }
  if (limit !== null && res.over > 0) {
    const late = RULES.lateFee * Math.ceil(res.over / RULES.latePeriod);
    run.budget -= late;
    lines.push({ text: `${money(-late)} liquidated damages (late)`, tone: 'down' });
    toast(`${money(-late)} late`, 'down');
  }
  const c = (run.stats[q.gen] ??= { right: 0, wrong: 0 });
  const cs = ((run.stageStats[run.stage] ??= {})[q.gen] ??= { right: 0, wrong: 0 });
  if (res.correct) {
    c.right++;
    cs.right++;
  } else {
    c.wrong++;
    cs.wrong++;
  }
  store.record(q.gen, res.correct);
  refreshHud();
  return lines;
}

/**
 * Ask one question. onBuilt(res, lines) runs after the answer and before the solution: it builds
 * and drives. note: a line above the card (a ramp part, a rework).
 */
async function ask(q, { feeTimes = 1, feeNote = '', note = '', onBuilt }) {
  const kind = q.kind;
  const limit = limitFor(kind);
  const format = kind === 'quick' || !q.numeric ? 'choice' : rng.chance(RULES.numberShare) ? 'number' : 'choice';
  currentQuestion = q;
  setMode('question');
  const host = $('q-host');
  host.replaceChildren();
  if (note) host.append(el('p', 'q-note', note));
  const out = await askQuestion(host, q, {
    format,
    timeLimit: limit,
    reveal: OPTS.reveal,
    bookmark: copies('bookmark'),
    secondOpinion: usesLeft('secondOpinion') > 0,
    canSkip: usesLeft('changeOrder') > 0,
    async onAnswer(res) {
      const lines = settle(q, res, { kind, limit, feeTimes, feeNote });
      host.querySelector('.q-note')?.setAttribute('hidden', '');
      await onBuilt(res, lines);
      host.querySelector('.q-note')?.removeAttribute('hidden');
      // The card shows the solution now. Keep the new piece in view.
      setMode('solution');
    },
  });
  host.replaceChildren();
  currentQuestion = null;
  return out;
}

/** Show a new piece: grow it, let the eagle react, drive it, then the banner. */
async function showPiece(piece, res, lines, { others = [], verdict = piece.verdict, buttonText } = {}) {
  setMode('drive', piece);
  if (res.correct || res.skipped) world.eagle.hop(2);
  else world.eagle.shake();
  await Promise.all([reveal(piece), ...others.map(reveal)]);
  if (piece.drive) await testDrive(world, piece, tailBefore(piece), (p) => marker.show(piece.drive.ringAt ?? p));
  else if (piece.flawAt) marker.show(piece.flawAt);
  if (piece.flaw) run.flawsBuilt++;
  if (piece.earth) run.earth++;
  refreshHud();
  await banner(verdict, lines, buttonText ?? (res.skipped ? 'Continue' : 'See the solution'));
  marker.hide();
}

function banner(verdict, lines, buttonText) {
  const node = $('banner');
  node.className = `banner tone-${verdict.tone}`;
  node.querySelector('.b-title').textContent = verdict.title;
  node.querySelector('.b-text').textContent = verdict.text;
  const ml = node.querySelector('.b-money');
  ml.replaceChildren();
  for (const l of lines) ml.append(el('span', l.tone, l.text));
  const btn = node.querySelector('.b-next');
  btn.textContent = buttonText;
  node.hidden = false;
  if (mode !== 'opening') setMode('banner');
  btn.focus({ preventScroll: true });
  return new Promise((resolve) => {
    btn.onclick = () => {
      node.hidden = true;
      resolve();
    };
  });
}

function moveEagleToEnd() {
  const eg = eagleSpot(run.end);
  return world.eagle.flyTo(eg.x, eg.z, yawOf(run.end.h) - 0.6, eg.y);
}

// ---------- Offer ----------

const SPECIAL = {
  ramp: { name: 'Interchange ramp', text: 'Elite: 2 or 3 linked parts in a row. Fee ×1.5, then a free item.', meta: 'Elite · Full and step' },
  supplier: { name: 'Supplier', text: 'Buy items for fee, or rework a flaw in the road.', meta: 'Shop' },
  office: { name: 'Site office', text: `+${money(RULES.office.budget)} budget, up to ${money(RULES.startBudget)}.`, meta: 'Rest' },
};

const ICONS = {
  stake: '<path d="M8 34 H40" /><path d="M24 30 V10" class="i-acc"/><path d="M24 10 h9 l-3 4 3 4 h-9" class="i-acc"/>',
  river: '<path d="M6 34 H18 A14 14 0 0 0 32 20 L32 20 L36 8" /><path d="M6 42 H18 A22 22 0 0 0 40 20" class="i-water"/>',
  fast: '<path d="M6 36 H16 A10 10 0 0 0 26 26 V8" /><path d="M32 20 l4 4 -4 4" class="i-acc"/>',
  cut: '<path d="M6 36 H16 A12 12 0 0 0 28 24 V8" /><path d="M10 26 L20 12 L22 22 Z" class="i-earth"/>',
  bank: '<path d="M6 30 L42 18" /><path d="M6 36 L42 36 L42 18 Z" class="i-earth"/>',
  stop: '<path d="M6 34 H42" /><circle cx="36" cy="24" r="6" class="i-stop"/><path d="M14 30 V20" class="i-acc"/>',
  ramp: '<path d="M6 38 C20 38 22 10 42 10" class="i-ramp"/><path d="M6 30 H42" />',
  supplier: '<rect x="10" y="18" width="28" height="20" class="i-box"/><path d="M10 24 H38 M24 18 V38" class="i-acc"/>',
  office: '<rect x="8" y="16" width="32" height="18" class="i-office"/><path d="M12 38 V34 M36 38 V34" /><rect x="14" y="20" width="8" height="6" class="i-win"/>',
  ridge: '<path d="M4 38 L42 38 L42 30 C30 12 18 12 6 30 Z" class="i-hill"/><path d="M6 30 C18 12 30 12 42 30" />',
  underpass: '<path d="M4 16 C18 36 30 36 44 16" /><path d="M10 22 H38" class="i-bridge"/>',
  hill: '<path d="M4 34 C14 34 18 16 26 16 L30 16" /><path d="M30 12 V20" class="i-acc"/><path d="M30 16 C36 16 38 24 44 24" />',
  downhill: '<path d="M4 14 L44 34" /><circle cx="36" cy="24" r="5" class="i-stop"/>',
  building: '<path d="M4 34 H14 A14 14 0 0 0 28 20 V6" /><rect x="22" y="28" width="16" height="12" class="i-house"/><path d="M20 28 L30 21 L40 28" class="i-roof"/>',
};

/** The weighted pick of a card kind. */
function pickKind(mix, used) {
  const pool = Object.entries(mix).filter(([k]) => k === 'road' || !used.has(k));
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of pool) {
    r -= w;
    if (r < 0) return k;
  }
  return 'road';
}

/** A road type for a card. Stage 2: vertical 2 times in 3, else a stage 1 type as review. */
function pickRoadType(taken) {
  const stage = run.stage;
  let pool = TYPES.filter((t) => t.stage.includes(stage) && !taken.has(t));
  if (stage >= 2) {
    const topic = rng.chance(RULES.stage2.verticalShare) ? 'vertical' : 'horizontal';
    const byTopic = pool.filter((t) => t.topic === topic);
    if (byTopic.length) pool = byTopic;
  }
  return rng.pick(pool);
}

function offerChoices(finalStep) {
  if (finalStep) return RULES.offer.last.map((kind) => ({ kind }));
  const n = rng.int(RULES.offerMin, RULES.offerMax);
  const taken = new Set();
  const used = new Set();
  let out = [];
  while (out.length < n) {
    const kind = run.steps >= RULES.offer.specialFrom ? pickKind(RULES.offer.mix, used) : 'road';
    if (kind === 'road') {
      const type = pickRoadType(taken);
      taken.add(type);
      out.push({ kind, type });
    } else {
      used.add(kind);
      out.push({ kind });
    }
  }
  if (OPTS.steps.length) {
    const forced = OPTS.steps[run.forced % OPTS.steps.length];
    run.forced++;
    const same = (a) => a.kind === forced.kind && (a.kind !== 'road' || a.type === forced.type);
    out = [forced, ...out.filter((a) => !same(a))].slice(0, Math.max(2, n));
  }
  return out;
}

function offer(finalStep) {
  const choices = offerChoices(finalStep);
  const host = $('offer');
  host.querySelector('h2').textContent = finalStep ? 'Last stop before opening day' : 'Pick the next segment';
  const list = host.querySelector('.offer-list');
  list.replaceChildren();
  setMode('offer');
  return new Promise((resolve) => {
    for (const c of choices) {
      const id = c.kind === 'road' ? c.type.id : c.kind;
      const b = button(`seg-card kind-${c.kind}`, '');
      b.dataset.type = id;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'seg-icon');
      svg.setAttribute('viewBox', '0 0 48 48');
      svg.setAttribute('aria-hidden', 'true');
      svg.innerHTML = ICONS[id];
      let name;
      let text;
      let meta;
      let stakes = '';
      if (c.kind === 'road') {
        name = c.type.name;
        text = c.type.text;
        const mixed = c.type.kind === 'mixed';
        const kindText = { quick: 'Quick', step: 'Step', full: 'Full', mixed: 'Full or step' }[c.type.kind];
        meta = `${c.type.id === 'stake' ? 'H1 or concept' : c.type.gen} · ${kindText}`;
        stakes = mixed
          ? `Right +${money(RULES.fee.step)} to +${money(RULES.fee.full)} · Wrong ${money(-RULES.damage.step)} to ${money(-RULES.damage.full)}`
          : `Right +${money(RULES.fee[c.type.kind])} · Wrong ${money(-RULES.damage[c.type.kind])}`;
      } else {
        ({ name, text, meta } = SPECIAL[c.kind]);
        if (c.kind === 'supplier' && reworkable().length) text += ` ${reworkable().length} flaw${reworkable().length === 1 ? '' : 's'} to rework.`;
      }
      const body = el('span', 'seg-body', el('span', 'seg-name', name), el('span', 'seg-text', text), el('span', 'seg-meta', el('span', 'seg-gen', meta), el('span', 'seg-stakes', stakes)));
      b.append(svg, body);
      b.addEventListener('click', () => {
        host.hidden = true;
        resolve(c);
      });
      list.append(b);
    }
    host.hidden = false;
  });
}

// ---------- Steps ----------

/** The piece fields that depend on the stage: stage 2 pieces sit on the hills. */
function stageSpec() {
  return run.stage >= 2 ? { stage: run.stage, baseY: GEOMETRY.base, elevated: true } : { stage: run.stage, baseY: 0, elevated: false };
}

async function playRoad(type, forceGen, forceAsk = null) {
  const q = segmentQuestion(type, rng, { conceptShare: RULES.stakeConceptShare, forceGen, forceAsk, stage: run.stage });
  const start = run.end;
  const turn = turnSign(start.h);
  const order = run.order++;
  let piece = null;
  await ask(q, {
    async onBuilt(res, lines) {
      piece = place({ typeId: type.id, q, out: res, start, turn, seed: rng.int(1, 1e9), look: 'road', order, stepName: type.name, gen: q.gen, kind: q.kind, ...stageSpec() });
      run.built++;
      run.end = piece.end;
      refreshHud();
      await showPiece(piece, res, lines);
    },
  });
  await moveEagleToEnd();
}

async function playRamp() {
  const elite = makeElite(rng, { stage: run.stage });
  const turn = turnSign(run.end.h);
  const st = stageSpec();
  const plan = planRamp(elite, run.end, turn, st);
  const base = run.order;
  run.order += plan.pieces.length;
  const last = plan.pieces.length - 1;
  const n = elite.questions.length;
  for (let i = 0; i < n; i++) {
    const q = elite.questions[i];
    await ask(q, {
      feeTimes: RULES.elite.fee,
      feeNote: `elite \u00d7${RULES.elite.fee}`,
      note: `Interchange ramp: ${elite.title}. Part ${i + 1} of ${n}, linked parts with the same inputs. Fee ×${RULES.elite.fee}.`,
      async onBuilt(res, lines) {
        const built = plan.parts[i].map((idx, k) => {
          const spec = plan.pieces[idx];
          const own = k === 0;
          const signs = [...(idx === 0 ? ['start'] : []), ...(idx === last ? ['end'] : [])];
          return place({
            ...spec,
            q: own ? q : null,
            out: own ? res : null,
            seed: rng.int(1, 1e9),
            look: 'ramp',
            order: base + idx,
            stepName: 'Interchange ramp',
            gen: q.gen,
            kind: q.kind,
            signs,
            stage: st.stage,
          });
        });
        if (i === n - 1) {
          run.built++;
          run.end = plan.pieces[last].end;
          refreshHud();
        }
        await showPiece(built[0], res, lines, { others: built.slice(1) });
      },
    });
    if (run.budget <= 0) return;
  }
  await moveEagleToEnd();
  await reward(elite.title);
}

/** Pick 1 of 2 random items for free (after the ramp). */
function reward(title) {
  const offers = rng.shuffle(ITEM_IDS).slice(0, RULES.elite.offers);
  setMode('panel');
  return new Promise((resolve) => {
    const list = el('div', 'item-list');
    for (const id of offers) {
      list.append(
        itemCard(
          id,
          copies(id),
          RULES,
          button('pe-btn pe-btn-main item-take', 'Take', () => {
            run.items[id] = copies(id) + 1;
            toast(`+1 ${ITEM_NAME[id]}`, 'up');
            closePanel();
            refreshHud();
            resolve();
          }),
        ),
      );
    }
    openPanel('reward', [el('p', 'kicker', 'Interchange ramp done'), el('h2', 'title', 'Pick a free item'), el('p', 'lead', `${title} is done. Take 1 of these 2 items.`), list]);
  });
}

function openPanel(kind, children) {
  const node = $('panel');
  node.className = `sheet panel panel-${kind}`;
  node.replaceChildren(...children);
  node.hidden = false;
}
function closePanel() {
  $('panel').hidden = true;
  $('panel').replaceChildren();
}

async function playSupplier() {
  const offers = rng.shuffle(ITEM_IDS).slice(0, RULES.supplier.offers);
  const bought = new Set();
  for (;;) {
    setMode('panel');
    const action = await new Promise((resolve) => {
      const list = el('div', 'item-list');
      for (const id of offers) {
        const price = RULES.price[id];
        let act;
        if (bought.has(id)) act = el('p', 'item-bought', 'Bought');
        else {
          act = button('pe-btn pe-btn-main item-buy', `Buy for ${money(price)}`, () => resolve({ type: 'buy', id }));
          if (run.fee < price) {
            act.disabled = true;
            act.textContent = `${money(price)}: not enough fee`;
          }
        }
        list.append(itemCard(id, copies(id), RULES, act, bought.has(id)));
      }
      const rework = el('div', 'rework-list');
      const fl = reworkable();
      if (fl.length) {
        for (const p of fl) {
          const b = button('pe-btn rework-btn', '', () => resolve({ type: 'rework', piece: p }));
          b.append(el('strong', '', p.stepName), ` ${p.flawName}`, el('span', 'rework-price', `Rework ${money(RULES.supplier.rework)}`));
          if (run.fee < RULES.supplier.rework) b.disabled = true;
          rework.append(b);
        }
      } else rework.append(el('p', 'small', 'No flaws in the road.'));
      openPanel('supplier', [
        el('p', 'kicker', 'Supplier'),
        el('h2', 'title', 'Supplier'),
        el('p', 'lead', `Items cost fee. You have ${money(run.fee)}. Items stack.`),
        list,
        el('h3', 'sub', `Rework (${money(RULES.supplier.rework)} fee): answer a new question of the same type. A right answer fixes the flaw.`),
        rework,
        button('pe-btn big panel-leave', 'Leave the supplier', () => resolve({ type: 'leave' })),
      ]);
    });
    if (action.type === 'leave') break;
    if (action.type === 'buy') {
      const price = RULES.price[action.id];
      if (run.fee < price) continue;
      run.fee -= price;
      run.items[action.id] = copies(action.id) + 1;
      bought.add(action.id);
      toast(`${ITEM_NAME[action.id]} ${money(-price)} fee`, 'down');
      refreshHud();
      continue;
    }
    closePanel();
    await rework(action.piece);
    if (run.budget <= 0) break;
  }
  closePanel();
}

/** Rework a flaw: a new question from the same generator. A right answer rebuilds the piece. */
async function rework(piece) {
  run.fee -= RULES.supplier.rework;
  toast(`Rework ${money(-RULES.supplier.rework)} fee`, 'down');
  refreshHud();
  const q = reworkQuestion(piece, rng);
  await ask(q, {
    feeTimes: 0,
    note: `Rework: ${piece.stepName}, ${lowerFirst(piece.flawName)}. A right answer fixes the flaw.`,
    async onBuilt(res, lines) {
      if (!res.correct) {
        camPiece = piece;
        setMode('banner', piece);
        marker.show(piece.flawAt);
        await banner({ tone: 'flaw', title: 'Rework failed', text: 'The answer is wrong, so the flaw stays in the road.' }, lines, res.skipped ? 'Continue' : 'See the solution');
        marker.hide();
        return;
      }
      world.scene.remove(piece.group);
      const fixed = buildPiece({ ...piece, out: { correct: true, skipped: false, value: piece.q.answer } }, clearFor(piece));
      for (const which of piece.signs ?? []) addRampSign(fixed, which);
      run.pieces[run.pieces.indexOf(piece)] = fixed;
      rebuildRoad();
      run.reworked++;
      await showPiece(fixed, res, lines, {
        verdict: { tone: 'clean', title: 'Flaw fixed', text: `The crew rebuilds the ${piece.stepName.toLowerCase()} with the right geometry. The car drives it clean.` },
      });
    },
  });
}

/** A small site office trailer beside the road end. p: { x, y, z, yaw }. */
function officeModel(p) {
  const g = group(world.scene, [p.x, p.y ?? 0, p.z]);
  g.rotation.y = p.yaw;
  box(g, [1.1, 0.5, 0.5], [0, 0.35, 0], '#f2efe7');
  box(g, [1.14, 0.06, 0.54], [0, 0.63, 0], '#3f74c9');
  box(g, [0.22, 0.16, 0.02], [-0.25, 0.42, 0.26], '#8ec5ea');
  box(g, [0.22, 0.16, 0.02], [0.2, 0.42, 0.26], '#8ec5ea');
  box(g, [0.14, 0.28, 0.02], [0.43, 0.27, 0.26], '#55341d');
  for (const x of [-0.4, 0.4]) box(g, [0.08, 0.1, 0.4], [x, 0.05, 0], '#5d6670');
  run.extras.push(g);
  return g;
}

async function playOffice() {
  const gain = Math.max(0, Math.min(RULES.office.budget, RULES.startBudget - run.budget));
  run.budget += gain;
  if (gain) toast(`+${money(gain)} budget`, 'up');
  refreshHud();
  const at2 = along(run.end, -0.6, 1.9);
  const o = { x: at2.x, z: at2.z, y: run.end.y ?? 0, yaw: yawOf(run.end.h) + Math.PI / 2 };
  run.offices.push(o);
  officeModel(o);
  world.eagle.hop(1);
  setMode('panel');
  await banner(
    {
      tone: 'clean',
      title: 'Site office',
      text: gain > 0 ? `The team takes a break. +${money(gain)} budget (the top is ${money(RULES.startBudget)}).` : `The team takes a break. The budget is already at the top (${money(RULES.startBudget)}).`,
    },
    gain ? [{ text: `+${money(gain)} budget`, tone: 'up' }] : [],
    'Back to the road',
  );
}

// ---------- Opening day ----------

/** Opening day for the current stage: the eagle and traffic use the road of this stage. */
async function openingDay() {
  const stage = run.stage;
  run.phase = 'opening';
  saveRun();
  setMode('panel');
  const pieces = run.pieces.filter((p) => p.stage === stage);
  const left = pieces.filter((p) => p.flaw && !p.claimed);
  const before = stage > 1 ? ' Flaws of stage 1 had their claims on the first opening day, so they cost nothing more.' : '';
  await new Promise((resolve) => {
    openPanel('opening', [
      el('p', 'kicker', `Stage ${stage} boss`),
      el('h2', 'title', stage > 1 ? `Opening day ${stage}` : 'Opening day'),
      el(
        'p',
        'lead',
        (left.length
          ? `Traffic and the eagle use the stage ${stage} road. ${left.length} flaw${left.length === 1 ? ' is' : 's are'} left. Each one causes its event and costs a ${money(RULES.claim)} claim. The stage is clear if the budget stays above $0.`
          : `Traffic and the eagle use the stage ${stage} road. No flaws are left, so no claims.`) + before,
      ),
      button('pe-btn pe-btn-main big opening-go', 'Open the road', resolve),
    ]);
  });
  closePanel();
  mode = 'opening';
  const head = stage === 1 ? run.stub : [];
  const roadOfStage = [...head, ...pieces.flatMap((p, k) => (k === 0 && !head.length ? p.samples : p.samples.slice(1)))];
  const lane = lanePath(roadOfStage, -0.3);
  const point = (d) => pointAt(lane, d);
  const startD = 0.4;
  const p0 = point(startD);
  world.eagle.watch(null);
  world.eagle.place(p0.x, p0.z, yawOf(p0.h), p0.y);
  world.snapCamera();
  const claims = $('claims');
  claims.replaceChildren(el('p', 'claims-head', `Opening day ${stage}: claims`));
  claims.hidden = false;
  // One traffic car follows the eagle in the right lane, a short gap back. It moves only while the
  // eagle runs, so both wait at each flaw. The eagle runs at the car's speed (R6 pose, faster strides).
  const runSet = runAtSpeed(RULES.opening.speed);
  const carLane = lanePath(roadOfStage, 0.3);
  const ratio = carLane[carLane.length - 1].d / lane[lane.length - 1].d;
  const traffic = follower(world, roadOfStage, () => (world.eagle.runD ?? startD) * ratio, RULES.opening.gap);
  openingCar = traffic.car;
  let d = startD;
  for (let i = 0; i <= pieces.length; i++) {
    const piece = pieces[i];
    if (piece && !(piece.flaw && !piece.claimed)) continue;
    // Run to just before the next flaw, or to the end of the road.
    const to = piece ? Math.max(d, distanceOf(lane, piece.samples[0].x, piece.samples[0].z) - 0.9) : lane[lane.length - 1].d - 0.6;
    if (to > d + 0.2) await world.eagle.runAlong(point, d, to, runSet);
    d = to;
    if (!piece) break;
    // The flaw plays its event again, and the owner pays a claim.
    openingFocus = piece;
    await testDrive(world, piece, tailBefore(piece), (p) => marker.show(piece.drive.ringAt ?? p));
    run.budget -= RULES.claim;
    piece.claimed = true;
    run.claims.push({ stage, order: piece.order, stepName: piece.stepName, flawName: piece.flawName, amount: RULES.claim });
    toast(`${money(-RULES.claim)} claim`, 'down');
    claims.append(el('p', 'claim', el('strong', '', piece.stepName), ` ${piece.flawName}: `, el('span', 'down', `${money(-RULES.claim)} claim`)));
    refreshHud();
    await sleep(RULES.opening.pause);
    marker.hide();
    openingFocus = null;
  }
  await sleep(400);
  traffic.remove();
  openingCar = null;
  claims.hidden = true;
  if (run.budget <= 0) return endRun('failed');
  run.cleared = stage;
  if (stage >= RULES.stages) return endRun('final');
  // The stage is clear: the next stage starts now, so a reload continues there.
  const done = stage;
  await startStage(stage + 1);
  saveRun();
  summary('stage', done);
}

// ---------- Stages ----------

/** Start a stage: new uses for the items, and (for the hills) a climb from the flat road. */
async function startStage(stage) {
  run.stage = stage;
  run.phase = 'build';
  run.built = 0;
  run.steps = 0;
  run.used = { secondOpinion: 0, changeOrder: 0, contingency: 0 };
  if (stage >= 2) {
    const climb = place({ typeId: 'climb', q: null, out: null, start: run.end, turn: 1, seed: 7 + stage, look: 'road', order: run.order++, stepName: 'Climb', stage, baseY: GEOMETRY.base, elevated: true });
    world.scene.add(climb.group);
    climb.road.reveal(1);
    run.end = climb.end;
    const eg = eagleSpot(run.end);
    world.eagle.place(eg.x, eg.z, yawOf(run.end.h) - 0.6, eg.y);
  }
  refreshHud();
}

// ---------- The loop ----------

/** A random source for one step. It depends only on the seed, the stage, and the step, so a reload repeats it. */
function stepRng() {
  const h = (Math.imul(run.seed >>> 0, 2654435761) ^ Math.imul(run.stage, 40503) ^ Math.imul(run.steps + 1, 2246822519)) >>> 0;
  return createRandom(h);
}

async function play() {
  const me = run;
  for (;;) {
    rng = stepRng();
    const finalStep = run.built >= RULES.stageLength;
    const choice = await offer(finalStep);
    if (choice.kind === 'road') await playRoad(choice.type, choice.gen ?? null, choice.ask ?? null);
    else if (choice.kind === 'ramp') await playRamp();
    else if (choice.kind === 'supplier') await playSupplier();
    else await playOffice();
    if (run !== me) return;
    run.steps++;
    if (run.budget <= 0) return endRun('over');
    if (finalStep) return openingDay();
    saveRun();
  }
}

// ---------- Saving ----------

const SAVE_VERSION = 1;
const PIECE_KEYS = ['typeId', 'q', 'out', 'start', 'end', 'turn', 'seed', 'look', 'variant', 'third', 'delta', 'fixedLength', 'order', 'stepName', 'gen', 'kind', 'signs', 'stage', 'baseY', 'elevated', 'claimed'];
const RUN_KEYS = ['seed', 'stage', 'phase', 'budget', 'fee', 'built', 'steps', 'stats', 'stageStats', 'items', 'used', 'order', 'forced', 'flawsBuilt', 'earth', 'reworked', 'claims', 'cleared', 'end', 'offices'];

/** Save the run: the state, and each piece as the answer that built it. */
function saveRun() {
  const data = { v: SAVE_VERSION };
  for (const k of RUN_KEYS) data[k] = run[k];
  data.pieces = run.pieces.map((p) => {
    const s = {};
    for (const k of PIECE_KEYS) if (p[k] !== undefined) s[k] = p[k];
    if (s.out) s.out = { correct: !!s.out.correct, skipped: !!s.out.skipped, value: s.out.value ?? null };
    return s;
  });
  store.save('run', data);
}

function loadSaved() {
  const r = store.load('run');
  if (!r || r.v !== SAVE_VERSION || !Array.isArray(r.pieces) || !Number.isFinite(r.budget)) return null;
  return r;
}

function resultText(r) {
  const what = r.cleared >= RULES.stages ? 'Run complete' : r.cleared > 0 ? `Stage ${r.cleared} cleared` : 'No stage cleared';
  return r.budget > 0 ? `${what}, ${money(r.budget)} budget left` : `${what}, over budget`;
}

/** Save the result if it is the best. Stages cleared count first, then the budget left. */
function saveBest() {
  const mine = { cleared: run.cleared, budget: run.budget, seed: run.seed };
  const best = store.load('best');
  const better = !best || mine.cleared > best.cleared || (mine.cleared === best.cleared && mine.budget > best.budget);
  if (better) store.save('best', mine);
  return { best: better ? mine : best, isNew: better };
}

/** The run is over: save the best result, delete the saved run, and show the run summary. */
function endRun(kind) {
  store.remove('run');
  const { best, isNew } = saveBest();
  summary(kind, run.stage, { best, isNew });
}

// ---------- Summary ----------

function summary(kind, stage, bestInfo = null) {
  setMode('summary');
  $('claims').hidden = true;
  const node = $('summary');
  const whole = kind !== 'stage';
  const titles = {
    over: 'Run over: the budget is spent',
    stage: `Stage ${stage} clear`,
    failed: `Opening day ${stage}: the budget is spent`,
    final: 'Run complete: both stages clear',
  };
  node.querySelector('.s-title').textContent = titles[kind];
  const claims = whole ? run.claims : run.claims.filter((c) => c.stage === stage);
  const claimTotal = claims.reduce((s, c) => s + c.amount, 0);
  const sub =
    kind === 'over'
      ? `The road stops in stage ${run.stage} after ${run.built} segment${run.built === 1 ? '' : 's'}.`
      : kind === 'stage'
        ? `The stage ${stage} road opened with ${claims.length} flaw${claims.length === 1 ? '' : 's'} left (${money(-claimTotal)} in claims). The road goes on into the hills.`
        : `The whole run: ${run.claims.length} claim${run.claims.length === 1 ? '' : 's'} (${money(-claimTotal)}).`;
  node.querySelector('.s-sub').textContent = sub;
  const stats = whole ? run.stats : (run.stageStats[stage] ?? {});
  node.querySelector('thead th').textContent = whole ? 'Question type (whole run)' : `Question type (stage ${stage})`;
  const body = node.querySelector('tbody');
  body.replaceChildren();
  const order = [...GENERATORS.map((g) => g.id), 'C'];
  let right = 0;
  let wrong = 0;
  for (const id of order) {
    const s = stats[id];
    if (!s) continue;
    right += s.right;
    wrong += s.wrong;
    body.append(el('tr', '', el('td', '', `${id === 'C' ? '' : `${id} `}${GEN_TITLE[id]}`), el('td', '', String(s.right)), el('td', '', String(s.wrong))));
  }
  body.append(el('tr', 'total', el('td', '', 'Total'), el('td', '', String(right)), el('td', '', String(wrong))));
  node.querySelector('.s-budget').textContent = money(run.budget);
  node.querySelector('.s-fee').textContent = money(run.fee);
  node.querySelector('.s-flaws').textContent = `${run.flawsBuilt} built, ${run.reworked} reworked`;
  node.querySelector('.s-earth').textContent = String(run.earth);
  node.querySelector('.s-claims').textContent = `${claims.length}: ${money(-claimTotal)}`;
  const list = node.querySelector('.s-claim-list');
  list.replaceChildren(...claims.map((c) => el('li', '', `${whole ? `Stage ${c.stage}, ` : ''}${c.stepName}: ${lowerFirst(c.flawName)}, ${money(-c.amount)}`)));
  list.hidden = claims.length === 0;
  const best = node.querySelector('.s-best');
  best.hidden = !bestInfo;
  if (bestInfo) best.textContent = `${bestInfo.isNew ? 'New best result' : 'Best result'}: ${resultText(bestInfo.best)}.`;
  const next = node.querySelector('.s-next');
  const fresh = node.querySelector('.s-new');
  next.hidden = whole;
  next.textContent = `Continue to stage ${stage + 1}`;
  fresh.className = whole ? 's-new pe-btn pe-btn-main' : 's-new pe-btn';
  node.hidden = false;
  (whole ? fresh : next).focus({ preventScroll: true });
}

$('summary').querySelector('.s-new').addEventListener('click', () => {
  store.remove('run');
  newRun();
});
$('summary').querySelector('.s-next').addEventListener('click', () => {
  $('summary').hidden = true;
  setMode('offer');
  play();
});

// ---------- Start screen ----------

function optionNotes() {
  const notes = [];
  if (OPTS.seed !== null) notes.push(`Seed ${OPTS.seed}`);
  if (OPTS.stage === 2) notes.push('Starts at stage 2');
  if (OPTS.reveal) notes.push('Answers shown');
  if (OPTS.notimer) notes.push('No timer');
  else if (OPTS.exam) notes.push('Exam pace: 6 min for each question');
  if (OPTS.fresh) notes.push('Saved run deleted (fresh)');
  if (OPTS.fee > 0) notes.push(`Start fee ${money(OPTS.fee)} (debug)`);
  const start = Object.entries(OPTS.items).map(([id, n]) => `${ITEM_NAME[id]} \u00d7${n}`);
  if (start.length > 0) notes.push(`Start items: ${start.join(', ')} (debug)`);
  if (OPTS.steps.length) notes.push(`Forced cards: ${params.get('segments')} (debug)`);
  if (OPTS.debug) notes.push('Debug hooks on');
  return notes;
}

function showStart() {
  const node = $('start');
  const saved = loadSaved();
  const best = store.load('best');
  const card = el('div', 's-card start-card');
  card.append(
    el('p', 'kicker', 'PE Civil: Transportation'),
    el('h1', 'title', 'Road Builder'),
    el('p', 'lead', 'Each answer builds a piece of road. A test car drives it, flaws stay in the road, and opening day charges a claim for each one.'),
  );
  const go = (fn) => () => {
    node.hidden = true;
    fn();
  };
  if (saved) {
    const where = saved.phase === 'opening' ? `stage ${saved.stage}, opening day` : `stage ${saved.stage}, ${saved.built} of ${RULES.stageLength} segments`;
    card.append(
      button('pe-btn pe-btn-main big start-continue', 'Continue', go(() => continueRun(saved))),
      el('p', 'small center', `Saved run: ${where}, ${money(saved.budget)} budget, ${money(saved.fee)} fee.`),
      button('pe-btn big start-new', 'New run', go(() => {
        store.remove('run');
        newRun();
      })),
    );
  } else {
    card.append(button('pe-btn pe-btn-main big start-new', 'New run', go(newRun)));
  }
  if (best) card.append(el('p', 'best', el('span', 'label', 'Best result'), el('span', '', resultText(best))));
  const notes = optionNotes();
  if (notes.length > 0) card.append(el('p', 'small', notes.join('. ') + '.'));
  node.replaceChildren(card);
  node.hidden = false;
}

if (OPTS.debug) {
  window.roadDebug = {
    RULES,
    get run() {
      return run;
    },
    get question() {
      return currentQuestion;
    },
    get mode() {
      return mode;
    },
    /** On opening day: true if the traffic car is inside the view (null when there is no car). */
    trafficInView() {
      if (!openingCar) return null;
      const p = openingCar.root.position.clone().project(world.camera);
      return Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
    },
    /**
     * Each (generator, kind) pair of GENERATORS, plus the concept question, and the segments
     * that can ask it in each stage. `missing` lists the pairs with no segment.
     */
    coverage() {
      const pairs = [...GENERATORS.flatMap((g) => g.kinds.map((k) => [g.id, k])), ['C', 'quick']];
      const rows = pairs.map(([gen, kind]) => {
        const row = { gen, kind };
        for (const stage of [1, 2]) {
          row[`stage${stage}`] = [...new Set(ASKS.filter((a) => a.stages.includes(stage) && a.pairs.some(([g, k]) => g === gen && k === kind)).map((a) => a.segment))];
        }
        return row;
      });
      return { rows, missing: rows.filter((r) => !r.stage1.length && !r.stage2.length).map((r) => `${r.gen} ${r.kind}`) };
    },
  };
}

if (OPTS.fresh) store.remove('run');
showStart();
