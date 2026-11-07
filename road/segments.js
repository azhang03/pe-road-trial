// The segment types: the question for each one, and the road piece that the answer builds.
// A piece always ends at the same pose, right or wrong, so a rework can rebuild it in place.
// The geometry is not to scale. Each type keeps its own sizes in GEOMETRY.

import * as THREE from 'three';
import { makeQuestion, makeConcept, formatValue } from '../shared/questions.js';
import { createRandom } from '../shared/rng.js';
import { pathFrom, offsetSamples } from './path.js';
import { box, cyl, group, label, roadMesh, waterMesh, coloredMesh, tree, ROAD_HALF, surfaceY } from './world.js';

const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** Sizes in world units (the eagle is about 1 tall). Angles in degrees. */
export const GEOMETRY = {
  /** A wrong design value draws at this ratio of the right one, clamped. */
  ratioMin: 0.3,
  ratioMax: 2.2,
  stake: { length: 3 },
  river: { R: 4, deltaMin: 30, deltaMax: 75, tanIn: 3, tanOut: 2.2, shiftMin: 0.35, shiftMax: 2.2, waterOffset: 1.85, waterHalf: 0.55 },
  // The bend keeps its PI, so a smaller radius starts later and ends sooner.
  fast: { R: 4.2, delta: 55, tanIn: 2.2, tanOut: 2.2 },
  // faceOffset: the right distance from the inside lane center to the foot of the cut slope.
  cut: { R: 4.2, delta: 80, tanIn: 2, tanOut: 2.4, faceOffset: 1.3, height: 1.15, extend: 15 },
  bank: { R: 4.5, delta: 55, bank: 18, transition: 2.6, tanIn: 1, tanOut: 1 },
  // sight: the right distance from the STOP AHEAD sign to the hazard.
  stop: { sight: 4.5, before: 1, after: 1.6, gap: 0.42 },
  // The bend around a building: a fixed 80° bend. Each ask uses its own radius, so the building fits.
  building: { delta: 80, tanIn: 1.5, tanOut: 2.5, mR: 6.5, eR: 4, lcR: 4.5, gap: 0.15 },
  // Stage 2. Elevations are above the flat ground. The hills sit at `base`.
  base: 1,
  // A crest curve: grades ±g, curve length Lv for a right answer.
  ridge: { length: 12, g: 0.2, Lv: 6, stopAt: 8 },
  // A sag under a bridge. The headlight reach for the right length is `reach`.
  underpass: { length: 14, g: 0.12, Lv: 8, reach: 5, debrisAt: 10.3, speed: 2.8 },
  hill: { length: 12, g: 0.12, Lv: 6, shiftMax: 2 },
  // A stop on a grade. The road first goes the other way, so the piece ends at the base again.
  downhill: { gradeMin: 0.05, gradeMax: 0.14, rise: 0.85, back: 2.6 },
  climb: { length: 5 },
  // The interchange ramp.
  ramp: { curveR: 4, deltaMin: 45, deltaMax: 90, tan: 1.5, cutDelta: 70, closeR: 4, closeTan: 1.2, wobbleMin: 0.25, wobbleMax: 0.9 },
};

/** The segment types. stage: the stages that offer it. topic: the stage 2 mix (2 vertical in 3). */
export const TYPES = [
  { id: 'stake', name: 'Survey stake', gen: 'H1', kind: 'quick', stage: [1, 2], topic: 'horizontal', text: 'Set the next stake. A degree of curve or a concept question.' },
  { id: 'river', name: 'River bend', gen: 'H2', kind: 'mixed', stage: [1, 2], topic: 'horizontal', text: 'The road follows the river. Stations, tangent length, or curve length.' },
  { id: 'building', name: 'Bend around a building', gen: 'H3', kind: 'step', stage: [1, 2], topic: 'horizontal', text: 'A building stands at the bend. Middle ordinate, external distance, or long chord.' },
  { id: 'fast', name: 'Fast bend', gen: 'H4', kind: 'full', stage: [1, 2], topic: 'horizontal', text: 'A bend at the design speed. Radius, side friction, or speed.' },
  { id: 'cut', name: 'Bend past a cut slope', gen: 'H5', kind: 'full', stage: [1, 2], topic: 'horizontal', text: 'Cut the slope back so that drivers see around the bend.' },
  { id: 'bank', name: 'Banked bend', gen: 'H6', kind: 'full', stage: [1, 2], topic: 'horizontal', text: 'Bank the bend. Superelevation runoff or runout length.' },
  { id: 'stop', name: 'Stop ahead', gen: 'V1', kind: 'mixed', stage: [1], topic: 'vertical', text: 'A hazard on a level road. Stopping sight distance, or its reaction or braking part.' },
  { id: 'ridge', name: 'Ridge', gen: 'V2', kind: 'mixed', stage: [2], topic: 'vertical', text: 'A crest curve over a hill. The crest must not hide a stopped car.' },
  { id: 'underpass', name: 'Underpass', gen: 'V3', kind: 'mixed', stage: [2], topic: 'vertical', text: 'A sag curve under a bridge. The headlights must reach far enough at night.' },
  { id: 'hill', name: 'Hill road', gen: 'V4', kind: 'mixed', stage: [2], topic: 'vertical', text: 'A vertical curve. Stations and elevations set the profile.' },
  { id: 'downhill', name: 'Downhill stop', gen: 'V1', kind: 'full', stage: [2], topic: 'vertical', text: 'A hazard on a grade. Stopping sight distance up or down the hill.' },
];
export const TYPE_BY_ID = Object.fromEntries(TYPES.map((t) => [t.id, t]));

/** The step asks of each generator. Any other ask is the full kind. */
const STEP_ASKS = { H2: ['T', 'L'], H3: ['M', 'E', 'LC'], V1: ['reaction', 'braking'], V2: ['K', 'LfromK', 'Lmin'], V3: ['K', 'LfromK', 'Lmin'], V4: ['PVC', 'PVT'] };

/** The one-line stories of the building bend, above the given values. */
const BUILDING_STORY = {
  M: ['A building stands inside the curve, at the midpoint of the long chord.'],
  E: ['A building stands near the PI, on the bisector of the curve.'],
  LC: ['The crew stakes the PT from the PC along the long chord.', 'The crew sights the PT from the PC at Δ/2 from the back tangent.'],
};

/** An H3 question for the building bend, with its story line(s) above the given values. */
export function buildingQuestion(rng, stage, ask = null) {
  const q = makeQuestion('H3', rng, { kind: 'step', stage, ...(ask ? { ask } : {}) });
  const story = BUILDING_STORY[q.figure?.ask] ?? [];
  return { ...q, prompt: [...story, q.prompt].join('\n') };
}

/**
 * The question for a segment. The stake asks H1 or a concept question (horizontal in stage 1,
 * vertical in stage 2). A mixed type is full or step, half each. The downhill stop asks V1 on a grade.
 * forceAsk (debug, ?segments=river:T) picks the ask and its kind.
 */
export function segmentQuestion(type, rng, { conceptShare, forceGen = null, forceAsk = null, stage = 1 }) {
  if (type.id === 'stake') {
    const concept = forceGen ? forceGen === 'C' : rng.chance(conceptShare);
    return concept ? makeConcept(rng, { topic: stage >= 2 ? 'vertical' : 'horizontal' }) : makeQuestion('H1', rng, { kind: 'quick', stage });
  }
  if (type.id === 'building') return buildingQuestion(rng, stage, forceAsk);
  if (type.id === 'downhill') return makeQuestion('V1', rng, { kind: 'full', stage: 2, ask: 'grade' });
  if (forceAsk) {
    const kind = (STEP_ASKS[type.gen] ?? []).includes(forceAsk) ? 'step' : 'full';
    return makeQuestion(type.gen, rng, { kind, stage, ask: forceAsk });
  }
  if (type.kind === 'mixed') return makeQuestion(type.gen, rng, { kind: rng.chance(0.5) ? 'full' : 'step', stage });
  return makeQuestion(type.gen, rng, { kind: type.kind, stage });
}

/** A new question for a rework: the same generator and kind (the building keeps its ask and story). */
export function reworkQuestion(piece, rng) {
  if (piece.typeId === 'building') return buildingQuestion(rng, piece.stage ?? 1, piece.q?.figure?.ask ?? null);
  return makeQuestion(piece.gen, rng, { kind: piece.kind, stage: piece.stage ?? 1 });
}

/**
 * The (generator, kind) pairs that each segment type can ask, and in which stages.
 * The ramp is the elite: stage 1 has Curve layout and Sight around a bend; stage 2 adds Crest and Sag design.
 */
export const ASKS = [
  { segment: 'stake', pairs: [['H1', 'quick'], ['C', 'quick']], stages: [1, 2] },
  { segment: 'river', pairs: [['H2', 'full'], ['H2', 'step']], stages: [1, 2] },
  { segment: 'building', pairs: [['H3', 'step']], stages: [1, 2] },
  { segment: 'fast', pairs: [['H4', 'full']], stages: [1, 2] },
  { segment: 'cut', pairs: [['H5', 'full']], stages: [1, 2] },
  { segment: 'bank', pairs: [['H6', 'full']], stages: [1, 2] },
  { segment: 'stop', pairs: [['V1', 'full'], ['V1', 'step']], stages: [1] },
  { segment: 'downhill', pairs: [['V1', 'full']], stages: [2] },
  { segment: 'ridge', pairs: [['V2', 'full'], ['V2', 'step']], stages: [2] },
  { segment: 'underpass', pairs: [['V3', 'full'], ['V3', 'step']], stages: [2] },
  { segment: 'hill', pairs: [['V4', 'full'], ['V4', 'step']], stages: [2] },
  { segment: 'ramp', pairs: [['H2', 'full'], ['H3', 'step'], ['V1', 'full'], ['H5', 'full']], stages: [1, 2] },
  { segment: 'ramp', pairs: [['V2', 'full'], ['V3', 'full'], ['V4', 'full']], stages: [2] },
];

// ---------- Judging the answer ----------

/**
 * The design ratio: built / right, where a value below 1 is on the unsafe side.
 * For a maximum speed, a higher value is unsafe, so the ratio is right / built.
 */
function designRatio(q, value) {
  if (value == null || !Number.isFinite(value) || q.answer == null) return 0.5;
  const unsafeHigh = q.figure?.type === 'superelevation' && q.figure.ask === 'V';
  const r = unsafeHigh ? q.answer / value : value / q.answer;
  return r > 0 ? r : GEOMETRY.ratioMin;
}

/** A right (or skipped) answer builds the right geometry. */
const RIGHT = { r: 1, rv: 1, flaw: false, earth: false, s: 0 };

function judge(q, out) {
  if (out.correct || out.skipped || q.answer == null) return RIGHT;
  const r = designRatio(q, out.value);
  return {
    r,
    rv: clamp(r, GEOMETRY.ratioMin, GEOMETRY.ratioMax),
    flaw: r < 1,
    earth: r >= 1,
    // Severity of a flaw, 0.15 to 1. A small error still shows a small event.
    s: clamp((1 - r) / 0.7, 0.15, 1),
  };
}

/** A station error as a shift along the curve. 2 ft draws about 0.5, 45 ft about 1.2, 2,000 ft about 2. */
function stationShift(q, out, G) {
  if (out.correct || out.skipped || out.value == null || !Number.isFinite(out.value)) return 0;
  const err = out.value - q.answer;
  return Math.sign(err || 1) * clamp(0.35 + 0.5 * Math.log10(Math.max(1, Math.abs(err))), G.shiftMin, G.shiftMax);
}

const NAMES = {
  H2: { PC: 'the PC station', PT: 'the PT station', T: 'the tangent length T', L: 'the curve length L' },
  H3: { M: 'the middle ordinate', E: 'the external distance', LC: 'the long chord' },
  V1: { reaction: 'the reaction distance', braking: 'the braking distance' },
  H4: { R: 'R', f: 'f', V: 'the posted speed' },
  H5: { HSO: 'the sightline offset' },
  H6: { Lr: 'L_r', Lt: 'L_t' },
  V2: { ssd: 'the curve length L', psd: 'the curve length L', K: 'K', LfromK: 'the curve length L', Lmin: 'L_min' },
  V3: { headlight: 'the curve length L', comfort: 'the curve length L', K: 'K', LfromK: 'the curve length L', Lmin: 'L_min' },
  V4: { PVC: 'the PVC station', PVT: 'the PVT station', turnStation: 'the station of the turning point', elevAt: 'the elevation', turnElev: 'the elevation of the turning point' },
};
function builtName(q) {
  return NAMES[q.gen]?.[q.figure?.ask] ?? (q.gen === 'V1' ? 'the SSD' : 'the value');
}
function builtLine(q, out) {
  const right = formatValue(q, q.answer);
  if (out.correct || out.skipped) return `You built ${builtName(q)} = ${right}.`;
  if (out.value == null) return `Right: ${right}.`;
  return `You built ${builtName(q)} = ${formatValue(q, out.value)}. Right: ${right}.`;
}

// ---------- Small models ----------

/**
 * The yaw that turns a +z face toward a driver who goes along heading h, turned 45° to the
 * right side of the road. The camera is behind the driver (tall screen) or on the right side
 * (wide screen), so the signs read on both.
 */
const faceDriver = (h) => Math.atan2(-Math.cos(h) - Math.sin(h), Math.cos(h) - Math.sin(h));
/** A point at distance `along` from (x, z) on heading h, and `side` to the right. */
export function at(x, z, h, along, side = 0) {
  return { x: x + Math.cos(h) * along - Math.sin(h) * side, z: z + Math.sin(h) * along + Math.cos(h) * side };
}

function post(parent, x, z, height) {
  cyl(parent, 0.025, height, [x, height / 2, z], '#8a8f96');
}

function signGroup(parent, x, z, h) {
  const g = group(parent, [x, 0, z]);
  g.rotation.y = faceDriver(h);
  g.scale.setScalar(1.35);
  post(g, 0, -0.03, 0.62);
  return g;
}

function speedSign(parent, x, z, h, speed) {
  const g = signGroup(parent, x, z, h);
  box(g, [0.3, 0.38, 0.025], [0, 0.72, 0], '#ffffff');
  label(g, 'SPEED', 0.26, 0.07, [0, 0.84, 0.014], '#1c1c1e', '#ffffff');
  label(g, String(Math.round(speed)), 0.26, 0.2, [0, 0.67, 0.014], '#1c1c1e', '#ffffff');
  return g;
}

function chevron(parent, x, z, h, right) {
  const g = signGroup(parent, x, z, h);
  box(g, [0.26, 0.3, 0.025], [0, 0.68, 0], '#1c1c1e');
  label(g, right ? '>' : '<', 0.24, 0.28, [0, 0.68, 0.014], '#f6c21a', '#1c1c1e');
  return g;
}

function stopAheadSign(parent, x, z, h) {
  const g = signGroup(parent, x, z, h);
  box(g, [0.34, 0.34, 0.025], [0, 0.78, 0], '#f6c21a', [0, 0, Math.PI / 4]);
  label(g, 'STOP AHEAD', 0.36, 0.11, [0, 0.78, 0.016], '#1c1c1e', '#f6c21a');
  return g;
}

function stopSign(parent, x, z, h) {
  const g = signGroup(parent, x, z, h);
  cyl(g, 0.22, 0.03, [0, 0.78, 0], '#c8342f', [Math.PI / 2, 0, Math.PI / 8], 8);
  label(g, 'STOP', 0.3, 0.12, [0, 0.78, 0.018], '#ffffff', '#c8342f');
  return g;
}

function rampSign(parent, x, z, h, text) {
  const g = signGroup(parent, x, z, h);
  box(g, [0.5, 0.24, 0.025], [0, 0.78, 0], '#2f7a45');
  label(g, text, 0.46, 0.2, [0, 0.78, 0.014], '#ffffff', '#2f7a45');
  return g;
}

/** A pile of extra earth beside the road. */
function earthPile(parent, x, z, rng) {
  const g = group(parent, [x, 0, z]);
  g.rotation.y = rng() * Math.PI;
  box(g, [0.7, 0.22, 0.5], [0, 0.11, 0], '#b58a5a');
  box(g, [0.45, 0.18, 0.34], [0.05, 0.3, 0.02], '#a07648');
  box(g, [0.22, 0.12, 0.2], [-0.05, 0.44, 0], '#c49a68');
  return g;
}

/** The survey stake with a flag. */
function stake(parent, x, z, ok) {
  const g = group(parent, [x, 0, z]);
  box(g, [0.08, 0.8, 0.08], [0, 0.4, 0], '#c9a26b');
  box(g, [0.1, 0.08, 0.1], [0, 0.82, 0], '#ffffff');
  box(g, [0.32, 0.2, 0.015], [0.17, 0.7, 0], ok ? '#ff7a1a' : '#c8352b');
  if (!ok) g.rotation.z = 0.5;
  return g;
}

/** The car that stands still on the road (hidden by the cut slope). */
export const STOPPED_COLOR = '#e0a010';

// ---------- The cut slope mound ----------

/**
 * A mound on the inside of a bend: a ring sector around (cx, cz). The cut face is at radius
 * `face` and leans back. Angles from a0 to a1 (radians, any order).
 */
function mound(cx, cz, face, a0, a1, height, bottom = 0) {
  const back = Math.max(0.25, face - 2.6);
  const prof = [
    [face, 0],
    [face - 0.45, height],
    [back + 0.35, height],
    [back, bottom],
  ];
  prof[0][1] = bottom;
  const colors = ['#c9a26b', '#a6cf7f', '#b9945f'];
  const n = 16;
  const P = (r, y, a) => [cx + r * Math.cos(a), y, cz + r * Math.sin(a)];
  const tris = [];
  for (let i = 0; i < n; i++) {
    const A = a0 + ((a1 - a0) * i) / n;
    const B = a0 + ((a1 - a0) * (i + 1)) / n;
    for (let k = 0; k < 3; k++) {
      const [r0, y0] = prof[k];
      const [r1, y1] = prof[k + 1];
      const p00 = P(r0, y0, A), p01 = P(r1, y1, A), p10 = P(r0, y0, B), p11 = P(r1, y1, B);
      tris.push([p00, p10, p11, colors[k]], [p00, p11, p01, colors[k]]);
    }
  }
  for (const a of [a0, a1]) {
    const q = prof.map(([r, y]) => P(r, y, a));
    tris.push([q[0], q[1], q[2], '#c9a26b'], [q[0], q[2], q[3], '#c9a26b']);
  }
  return coloredMesh(tris);
}

// ---------- Plans: the start and end pose of each piece ----------

/** The end pose of a path made of straights and arcs, from the start. Keeps the elevation. */
function endOf(start, steps) {
  const p = pathFrom(start.x, start.z, start.h, start.y ?? 0);
  for (const [kind, a, b] of steps) {
    if (kind === 's') p.straight(a);
    else p.arc(a, b);
  }
  const e = p.last();
  return { x: e.x, y: e.y, z: e.z, h: e.h };
}

/**
 * The plan of an interchange ramp for an elite: the pieces in road order, and for each part of
 * the elite, the pieces that it builds. Each piece has a start pose and a fixed end pose.
 * opts: { baseY, elevated } for the hills of stage 2.
 */
export function planRamp(elite, start, turn, opts = {}) {
  const G = GEOMETRY.ramp;
  const [q0] = elite.questions;
  const lift = (pieces) => pieces.map((p) => ({ ...p, baseY: opts.baseY ?? 0, elevated: !!opts.elevated }));
  if (q0.gen === 'H2') {
    // Curve layout: PC, PT, then M. One curve in three thirds: PC, M, PT in road order.
    const delta = clamp(q0.figure?.delta ?? 60, G.deltaMin, G.deltaMax) * DEG * turn;
    const third = delta / 3;
    const s0 = start;
    const s1 = endOf(s0, [['s', G.tan], ['a', G.curveR, third]]);
    const s2 = endOf(s1, [['a', G.curveR, third]]);
    const s3 = endOf(s2, [['a', G.curveR, third], ['s', G.tan]]);
    const pieces = [
      { typeId: 'curve', variant: 'PC', start: s0, end: s1, turn, third },
      { typeId: 'curve', variant: 'M', start: s1, end: s2, turn, third },
      { typeId: 'curve', variant: 'PT', start: s2, end: s3, turn, third },
    ];
    return { title: elite.title, pieces: lift(pieces), parts: [[0], [2], [1]] };
  }
  if (q0.gen === 'V2' || q0.gen === 'V3') {
    // Crest design or sag design: the curve, then two hill road parts (a station, an elevation).
    const first = q0.gen === 'V2' ? 'ridge' : 'underpass';
    const L1 = GEOMETRY[first].length;
    const L2 = GEOMETRY.hill.length;
    const s0 = start;
    const s1 = endOf(s0, [['s', L1]]);
    const s2 = endOf(s1, [['s', L2]]);
    const s3 = endOf(s2, [['s', L2]]);
    const pieces = [
      { typeId: first, start: s0, end: s1, turn },
      { typeId: 'hill', start: s1, end: s2, turn },
      { typeId: 'hill', start: s2, end: s3, turn },
    ];
    return { title: elite.title, pieces: lift(pieces), parts: [[0], [1], [2]] };
  }
  // Sight around a bend: V1 (design SSD), then H5 (sightline offset). A closing bend turns back.
  const C = GEOMETRY.cut;
  const S = GEOMETRY.stop;
  const s0 = start;
  const s1 = endOf(s0, [['s', S.before + S.gap + S.sight + S.after]]);
  const cutDelta = G.cutDelta * DEG * turn;
  const s2 = endOf(s1, [['s', C.tanIn], ['a', C.R, cutDelta], ['s', C.tanOut]]);
  const s3 = endOf(s2, [['a', G.closeR, -cutDelta], ['s', G.closeTan]]);
  const pieces = [
    { typeId: 'stop', start: s0, end: s1, turn, fixedLength: true },
    { typeId: 'cut', start: s1, end: s2, turn, delta: G.cutDelta },
    { typeId: 'plain', start: s2, end: s3, turn: -turn, delta: G.cutDelta },
  ];
  return { title: elite.title, pieces: lift(pieces), parts: [[0], [1, 2]] };
}

// ---------- Build ----------

/**
 * Build one piece of road.
 * spec: { typeId, q, out, start, turn, seed, look ('road' | 'ramp'), variant, third, delta, fixedLength, end }.
 * clear(x, z, r): true if no other road is within r of the point (for trees and piles).
 * Returns the piece: samples, end, group, road, pops, drive data, verdict, and the flaw.
 */
export function buildPiece(spec, clear) {
  const { typeId, q, out, start, turn } = spec;
  const rng = createRandom(spec.seed);
  const j = q ? judge(q, out) : RIGHT;
  const base = spec.baseY ?? 0;
  const g = new THREE.Group();
  // The extras (signs, rocks, piles, mounds) stand on the base level of the piece.
  const xg = group(g, [0, base, 0]);
  const pops = [];
  const avoid = [];
  const path = pathFrom(start.x, start.z, start.h, base);
  const piece = { ...spec, group: g, pops, flaw: false, earth: false, flawAt: null, flawName: '', drive: null };
  const ctx = { piece, q, out: out ?? { correct: true }, j, g: xg, root: g, base, pops, avoid, path, start, turn, rng, spec };
  BUILDERS[typeId](ctx);

  piece.samples = path.pts;
  const e = path.last();
  piece.end = { x: e.x, y: e.y, z: e.z, h: e.h };
  if (piece.flawAt && piece.flawAt.y === undefined) piece.flawAt.y = nearestY(piece.samples, piece.flawAt);
  if (piece.drive && piece.drive.ground === undefined) piece.drive.ground = base;
  piece.road = roadMesh(piece.samples, { ramp: spec.look === 'ramp' });
  g.add(piece.road.group);
  // In the hills, side terrain shows the cut and the fill.
  if (spec.elevated) {
    const t = terrain(piece.samples, typeId === 'climb' ? null : base);
    g.add(t);
    t.userData.grow = 'y';
    pops.push(t);
  }
  const g2 = xg;

  // Extra earthwork for a design value that is too large.
  // Only a design minimum is too large: a curve length or a station is a flaw either way.
  if (j.earth && q && q.answerType !== 'station' && q.answerType !== 'elevation' && q.gen !== 'H3' && q.gen !== 'H2') {
    piece.earth = true;
    const count = clamp(Math.round((j.r - 1) * 5) + 1, 1, 6);
    for (let i = 0, tries = 0; i < count && tries < 40; tries++) {
      const s = piece.samples[Math.floor(rng() * piece.samples.length)];
      const side = rng.chance(0.5) ? 1 : -1;
      const p = at(s.x, s.z, s.h, 0, side * (1.35 + rng() * 0.6));
      if (!clear(p.x, p.z, 1.0) || !freeOf(avoid, p.x, p.z) || !nearOwn(piece.samples, p.x, p.z, 1.0)) continue;
      const pile = earthPile(g2, p.x, p.z, rng);
      pile.userData.decor = true;
      pops.push(pile);
      i++;
    }
  }

  // A few trees, clear of every road and of this piece's features. In the hills they stand past the terrain.
  const trees = spec.look === 'ramp' ? rng.int(0, 2) : rng.int(2, 4);
  const near = spec.elevated ? 4.2 : 2.4;
  for (let i = 0, tries = 0; i < trees && tries < 30; tries++) {
    const s = piece.samples[Math.floor(rng() * piece.samples.length)];
    const side = rng.chance(0.5) ? 1 : -1;
    const p = at(s.x, s.z, s.h, 0, side * (near + rng() * 2));
    if (!clear(p.x, p.z, 1.6) || !freeOf(avoid, p.x, p.z) || !nearOwn(piece.samples, p.x, p.z, near - 0.3)) continue;
    const t = tree(g, p.x, p.z, 0.8 + rng() * 0.5);
    t.userData.decor = true;
    pops.push(t);
    i++;
  }

  piece.verdict = q ? verdict(typeId, q, ctx.out, j, piece) : null;
  return piece;
}

/** True if the point is outside every avoid circle. */
function freeOf(avoid, x, z) {
  return avoid.every((c) => Math.hypot(x - c.x, z - c.z) >= c.r);
}
/** True if no sample of this piece is within r. */
function nearOwn(samples, x, z, r) {
  return samples.every((s) => Math.hypot(x - s.x, z - s.z) >= r);
}

function buildStake({ piece, out, path, g, pops }) {
  path.straight(GEOMETRY.stake.length);
  const s = path.pts[Math.floor(path.pts.length / 2)];
  const p = at(s.x, s.z, s.h, 0, ROAD_HALF + 0.35);
  pops.push(stake(g, p.x, p.z, out.correct || out.skipped));
  piece.drive = null;
}

function buildRiver({ piece, q, out, path, g, pops, avoid, turn }) {
  const G = GEOMETRY.river;
  const delta = clamp(q.figure?.delta ?? 45, G.deltaMin, G.deltaMax) * DEG * turn;
  const ask = q.figure?.ask ?? 'PC';
  const s0 = path.last();
  const h0 = s0.h;
  const pc = at(s0.x, s0.z, h0, G.tanIn);
  const arcLen = G.R * Math.abs(delta);
  const h1 = h0 + delta;
  const cx = pc.x - Math.sin(h0) * turn * G.R;
  const cz = pc.z + Math.cos(h0) * turn * G.R;
  const psi0 = Math.atan2(pc.z - cz, pc.x - cx);
  const pt = { x: cx + G.R * Math.cos(psi0 + delta), z: cz + G.R * Math.sin(psi0 + delta) };
  const q1 = at(pt.x, pt.z, h1, G.tanOut - 0.8);

  const kinks = [];
  const wrong = !out.correct && !out.skipped && out.value != null && Number.isFinite(out.value) && q.answer != null;
  if (wrong && ask === 'T') {
    // A wrong T keeps R and Δ, but the PC = PI − T moves along the back tangent. The curve leaves
    // the back tangent smoothly and misses the forward tangent: a sideways step at the exit.
    const err = out.value - q.answer;
    const mag = clamp(0.35 + 0.5 * Math.log10(Math.max(1, Math.abs(err))), G.shiftMin, G.shiftMax);
    const cosD = Math.max(0.2, Math.cos(delta * turn));
    const shift = clamp(-Math.sign(err || 1) * mag, -(G.tanIn - 0.4), (G.tanOut - 0.75) / cosD);
    path.straight(G.tanIn + shift);
    path.arc(G.R, delta);
    const a = path.last();
    kinks.push({ x: a.x, z: a.z });
    const alongA = (a.x - pt.x) * Math.cos(h1) + (a.z - pt.z) * Math.sin(h1);
    const alongQ = Math.min(Math.max(alongA, 0) + 0.5, G.tanOut - 0.25);
    const q2 = at(pt.x, pt.z, h1, alongQ);
    path.lineTo(q2.x, q2.z);
    kinks.push({ x: q2.x, z: q2.z });
    path.turnTo(h1);
    path.straight(G.tanOut - alongQ);
    setFlaw(piece, kinks[0], 'Step at the exit (T)');
    piece.drive = { kind: 'river', kinks, s: clamp(mag / G.shiftMax, 0.25, 1) };
  } else if (wrong && ask === 'L') {
    // A wrong L turns through L/R with the right R: the curve over-turns or under-turns, a kink at the exit.
    let f = clamp(out.value / q.answer, 0.3, 1.8);
    if (Math.abs(f - 1) < 0.08) f = 1 + Math.sign(f - 1 || 1) * 0.08;
    const turnB = clamp(Math.abs(delta) * f, 0.15, Math.abs(delta) + 0.9) * turn;
    path.straight(G.tanIn);
    path.arc(G.R, turnB);
    const a = path.last();
    kinks.push({ x: a.x, z: a.z });
    path.lineTo(q1.x, q1.z);
    kinks.push({ x: q1.x, z: q1.z });
    path.turnTo(h1);
    path.straight(0.8);
    setFlaw(piece, kinks[0], 'Kink at the exit (L)');
    piece.drive = { kind: 'river', kinks, s: clamp(Math.abs(f - 1) / 0.6, 0.25, 1) };
  } else {
    let shift = ask === 'PC' || ask === 'PT' ? stationShift(q, out, G) : 0;
    if (ask === 'PC') shift = Math.max(shift, -(G.tanIn - 0.6));
    else shift = Math.max(shift, -(arcLen - 0.4));
    if (shift === 0) {
      path.straight(G.tanIn);
      path.arc(G.R, delta);
      path.straight(G.tanOut);
    } else {
      if (ask === 'PC') {
        path.straight(G.tanIn + shift);
        path.arc(G.R, delta);
      } else {
        path.straight(G.tanIn);
        path.arc(G.R, (Math.sign(delta) * (arcLen + shift)) / G.R);
      }
      const a = path.last();
      kinks.push({ x: a.x, z: a.z });
      path.lineTo(q1.x, q1.z);
      kinks.push({ x: q1.x, z: q1.z });
      path.turnTo(h1);
      path.straight(0.8);
      setFlaw(piece, kinks[0], ask === 'PC' ? 'Kink at the PC' : 'Kink at the PT');
    }
    piece.drive = { kind: 'river', kinks, s: shift === 0 ? 0 : clamp(Math.abs(shift) / G.shiftMax, 0.2, 1) };
  }
  // An L question: the PT station marker stands at PC + L, so a wrong L puts it in the wrong place.
  if (ask === 'L' && q.figure) {
    const Lb = wrong ? out.value : q.answer;
    const pcSta = q.figure.piStation - q.figure.R * Math.tan((q.figure.delta * DEG) / 2);
    const e = kinks.length ? kinks[0] : pt;
    const hEnd = kinks.length ? path.pts.find((p) => Math.hypot(p.x - e.x, p.z - e.z) < 1e-6)?.h ?? h1 : h1;
    const mk = at(e.x, e.z, hEnd, 0, -turn * (ROAD_HALF + 0.4));
    pops.push(stationSign(g, mk.x, mk.z, hEnd, `PT ${staText(pcSta + Lb)}`));
  }

  // The river runs outside the right curve. It comes in from afar and leaves again.
  const water = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = at(pc.x, pc.z, h0, -3 + 3 * t);
    water.push({ x: p.x, z: p.z, h: h0, off: G.waterOffset + 1.6 * (1 - t) ** 2 });
  }
  const m = Math.max(4, Math.ceil(arcLen / 0.3));
  for (let i = 1; i <= m; i++) {
    const k = (delta * i) / m;
    water.push({ x: cx + G.R * Math.cos(psi0 + k), z: cz + G.R * Math.sin(psi0 + k), h: h0 + k, off: G.waterOffset });
  }
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const p = at(pt.x, pt.z, h1, 3 * t);
    water.push({ x: p.x, z: p.z, h: h1, off: G.waterOffset + 1.6 * t * t });
  }
  const river = water.map((w) => ({ ...offsetSamples([w], -turn * w.off)[0], h: w.h }));
  const wm = waterMesh(river, G.waterHalf);
  g.add(wm);
  wm.userData.grow = 'y';
  pops.push(wm);
  for (const w of river) avoid.push({ x: w.x, z: w.z, r: 1.0 });
}

/** A station in the form 98+40.51. */
function staText(x) {
  const s = Math.max(0, x);
  const whole = Math.floor(s / 100);
  return `${whole}+${(s - whole * 100).toFixed(2).padStart(5, '0')}`;
}

/** A white station board on a post. */
function stationSign(parent, x, z, h, text) {
  const g = signGroup(parent, x, z, h);
  box(g, [0.62, 0.2, 0.025], [0, 0.74, 0], '#ffffff');
  label(g, text, 0.58, 0.16, [0, 0.74, 0.014], '#1c1c1e', '#ffffff');
  return g;
}

/** One third of the ramp curve: the PC part, the middle (M), or the PT part. */
function buildCurve({ piece, q, out, j, path, turn, spec }) {
  const G = GEOMETRY.ramp;
  const R = G.curveR;
  const third = spec.third;
  const kinks = [];
  const end = spec.end;
  if (spec.variant === 'M') {
    // The middle ordinate sets the bulge of the middle third. A wrong value makes a wobble.
    path.arc(R, third);
    if (!j.flaw && !j.earth) {
      piece.drive = { kind: 'river', kinks: [], s: 0 };
      return;
    }
    const amp = Math.sign(j.r - 1 || -1) * clamp(Math.abs(Math.log2(j.r)) * 0.6, G.wobbleMin, G.wobbleMax);
    const pts = path.pts;
    const n = pts.length - 1;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      // Outward is away from the center, on the -turn side.
      const off = -turn * amp * Math.sin(Math.PI * t);
      pts[i].x -= Math.sin(pts[i].h) * off;
      pts[i].z += Math.cos(pts[i].h) * off;
    }
    // The headings follow the new line.
    const hs = pts.map((p, i) => (i === 0 || i === n ? p.h : Math.atan2(pts[i + 1].z - pts[i - 1].z, pts[i + 1].x - pts[i - 1].x)));
    pts.forEach((p, i) => {
      p.h = hs[i];
    });
    const mid = pts[Math.floor(n / 2)];
    kinks.push({ x: mid.x, z: mid.z });
    setFlaw(piece, mid, 'Wobble in the curve');
    piece.drive = { kind: 'river', kinks, s: clamp(Math.abs(amp) / G.wobbleMax, 0.3, 1) };
    return;
  }
  const Gr = { ...GEOMETRY.river, shiftMax: 1.4 };
  let shift = stationShift(q, out, Gr);
  const arcLen = R * Math.abs(third);
  if (spec.variant === 'PC') {
    shift = clamp(shift, -(G.tan - 0.4), 1.4);
    if (shift === 0) {
      path.straight(G.tan);
      path.arc(R, third);
    } else {
      path.straight(G.tan + shift);
      path.arc(R, (Math.sign(third) * Math.max(0.3, arcLen - Math.max(0, shift))) / R);
      const a = path.last();
      kinks.push({ x: a.x, z: a.z });
      path.lineTo(end.x, end.z);
      kinks.push({ x: end.x, z: end.z });
      path.turnTo(end.h);
      setFlaw(piece, kinks[0], 'Kink at the PC');
    }
  } else {
    shift = clamp(shift, -(arcLen - 0.4), 1.4);
    if (shift === 0) {
      path.arc(R, third);
      path.straight(G.tan);
    } else {
      path.arc(R, (Math.sign(third) * (arcLen + shift)) / R);
      const a = path.last();
      kinks.push({ x: a.x, z: a.z });
      const q1 = at(end.x, end.z, end.h, -0.6);
      path.lineTo(q1.x, q1.z);
      kinks.push({ x: q1.x, z: q1.z });
      path.turnTo(end.h);
      path.straight(0.6);
      setFlaw(piece, kinks[0], 'Kink at the PT');
    }
  }
  piece.drive = { kind: 'river', kinks, s: shift === 0 ? 0 : clamp(Math.abs(shift) / 1.4, 0.25, 1) };
}

function buildFast({ piece, q, out, j, path, g, pops, avoid, turn }) {
  const G = GEOMETRY.fast;
  const delta = G.delta * DEG * turn;
  const tanHalf = Math.tan((G.delta * DEG) / 2);
  const T0 = G.R * tanHalf;
  // The PI stays fixed. The largest radius that still fits on the tangents.
  const R = Math.min(G.R * j.rv, (G.tanIn + T0 - 0.2) / tanHalf);
  const Tb = R * tanHalf;
  const s0 = path.last();
  const speed = q.figure?.ask === 'V' && !out.correct && !out.skipped && Number.isFinite(out.value) ? out.value : (q.figure?.V ?? 60);
  const sp = at(s0.x, s0.z, s0.h, 0.6, ROAD_HALF + 0.3);
  pops.push(speedSign(g, sp.x, sp.z, s0.h, speed));
  path.straight(G.tanIn + T0 - Tb);
  const arcStart = path.n - 1;
  const c = path.arc(R, delta);
  const arcEnd = path.n - 1;
  path.straight(G.tanOut + T0 - Tb);
  // Chevrons on the outside of the bend.
  const count = clamp(Math.round((R * Math.abs(delta)) / 1.4), 2, 6);
  for (let i = 0; i < count; i++) {
    const k = c.psi0 + ((c.psi1 - c.psi0) * (i + 0.5)) / count;
    const r = R + ROAD_HALF + 0.35;
    pops.push(chevron(g, c.cx + r * Math.cos(k), c.cz + r * Math.sin(k), s0.h + (k - c.psi0), turn > 0));
  }
  avoid.push({ x: c.cx, z: c.cz, r: 0.5 });
  const mid = path.pts[Math.floor((arcStart + arcEnd) / 2)];
  if (j.flaw) setFlaw(piece, mid, 'Bend too sharp');
  piece.drive = { kind: 'fast', flaw: j.flaw, s: j.s, arcStart: path.pts[arcStart], arcEnd: path.pts[arcEnd], turn };
}

function buildCut({ piece, j, path, g, pops, avoid, turn, spec }) {
  const G = GEOMETRY.cut;
  const delta = (spec.delta ?? G.delta) * DEG * turn;
  path.straight(G.tanIn);
  const arcStart = path.n - 1;
  const c = path.arc(G.R, delta);
  path.straight(G.tanOut);
  // The cut slope on the inside. Its foot is `offset` from the center of the inside lane.
  const laneR = G.R - ROAD_HALF / 2;
  const offset = G.faceOffset * j.rv;
  const face = Math.min(laneR - offset, G.R - ROAD_HALF - 0.04);
  const ext = G.extend * DEG * turn;
  const a0 = c.psi0 - ext;
  const a1 = c.psi1 + ext;
  const mm = mound(c.cx, c.cz, face, a0, a1, G.height, -(spec.baseY ?? 0));
  g.add(mm);
  mm.userData.grow = 'y';
  pops.push(mm);
  avoid.push({ x: c.cx, z: c.cz, r: face + 0.6 });
  // The stopped car: in the inside lane, just past the bend, in the direction of the test car.
  // A right turn: the test car drives forward in the right lane, which is the inside lane.
  // A left turn: the inside lane is the left lane, so the test car comes the other way.
  const reverse = turn < 0;
  const ang = c.psi0 + (c.psi1 - c.psi0) * (reverse ? 0.08 : 0.92);
  const stopped = { x: c.cx + laneR * Math.cos(ang), z: c.cz + laneR * Math.sin(ang) };
  if (j.flaw) setFlaw(piece, stopped, 'Slope hides cars');
  piece.drive = {
    kind: 'cut',
    reverse,
    circle: { x: c.cx, z: c.cz, face, a0: Math.min(a0, a1), a1: Math.max(a0, a1) },
    stopped,
    arcStart: path.pts[arcStart],
  };
}

function buildBank({ piece, j, path, avoid, turn, g, pops }) {
  const G = GEOMETRY.bank;
  // The bend stays in place. A shorter transition starts later on the tangent.
  const T = Math.min(G.transition * j.rv, G.transition + G.tanIn - 0.1);
  const delta = G.delta * DEG * turn;
  // The outside of the bend goes up: a right turn lifts the left side.
  const full = -turn * G.bank * DEG;
  path.straight(G.tanIn + G.transition - T);
  const i0 = path.n - 1;
  path.straight(T);
  const i1 = path.n - 1;
  const c = path.arc(G.R, delta);
  const i2 = path.n - 1;
  path.straight(T);
  const i3 = path.n - 1;
  path.straight(G.tanOut + G.transition - T);
  const pts = path.pts;
  for (let i = i0; i <= i1; i++) pts[i].bank = (full * (i - i0)) / Math.max(1, i1 - i0);
  for (let i = i1; i <= i2; i++) pts[i].bank = full;
  for (let i = i2; i <= i3; i++) pts[i].bank = full * (1 - (i - i2) / Math.max(1, i3 - i2));
  avoid.push({ x: c.cx, z: c.cz, r: 0.5 });
  for (let i = 0; i < 3; i++) {
    const k = c.psi0 + ((c.psi1 - c.psi0) * (i + 0.5)) / 3;
    const r = G.R + ROAD_HALF + 0.4;
    pops.push(chevron(g, c.cx + r * Math.cos(k), c.cz + r * Math.sin(k), pts[i1].h + (k - c.psi0), turn > 0));
  }
  if (j.flaw) setFlaw(piece, pts[i1], 'Bank changes too fast');
  piece.drive = {
    kind: 'bank',
    flaw: j.flaw,
    s: j.s,
    transitions: [
      [pts[i0], pts[i1]],
      [pts[i2], pts[i3]],
    ],
  };
}

function buildStop(ctx) {
  const { q, j, path, spec } = ctx;
  const G = GEOMETRY.stop;
  // In a ramp the piece has a fixed length, so a longer zone draws at the right one.
  const z = zoneLengths(q, j, G.sight, spec.fixedLength ? 1 : Infinity);
  const s0 = path.last();
  const hazardAt = G.before + G.gap + Math.max(z.rb + z.bb, G.sight);
  path.straight(hazardAt + G.after);
  stopScene(ctx, s0, hazardAt, z);
}

/** A plain bend with no question (the end of a ramp). */
function buildPlain({ piece, path, turn, spec }) {
  const G = GEOMETRY.ramp;
  path.arc(G.closeR, (spec.delta ?? 60) * DEG * turn);
  path.straight(G.closeTan);
  piece.drive = null;
}

// ---------- Stage 2: the hills ----------

/** An equal-tangent vertical curve on a straight piece that starts and ends at `base`. */
function vcurve(base, length, g1, Lv) {
  const g2 = -g1;
  const pvi = length / 2;
  const pvc = pvi - Lv / 2;
  const pvt = pvi + Lv / 2;
  const tangent = (d) => (d <= pvi ? base + g1 * d : base + g1 * pvi + g2 * (d - pvi));
  const f = (d) => {
    if (d <= pvc || d >= pvt) return tangent(d);
    const x = d - pvc;
    return base + g1 * pvc + g1 * x + ((g2 - g1) * x * x) / (2 * Lv);
  };
  return { f, tangent, pvi, pvc, pvt };
}

/** Add a straight piece with the elevation y(d). At each distance in `breaks`, y can jump (a step). */
function straightProfile(path, length, y, breaks = []) {
  const s0 = path.last();
  s0.y = y(0);
  const ds = [];
  const n = Math.ceil(length / 0.3);
  for (let i = 1; i <= n; i++) ds.push((length * i) / n);
  for (const b of breaks) if (b > 0.01 && b < length - 0.01) ds.push(b - 0.002, b + 0.002);
  ds.sort((a, b) => a - b);
  for (const d of ds) path.pts.push({ x: s0.x + Math.cos(s0.h) * d, y: y(d), z: s0.z + Math.sin(s0.h) * d, h: s0.h, bank: 0 });
}

function nearestY(samples, p) {
  let best = samples[0];
  for (const s of samples) if ((s.x - p.x) ** 2 + (s.z - p.z) ** 2 < (best.x - p.x) ** 2 + (best.z - p.z) ** 2) best = s;
  return best.y ?? 0;
}

/**
 * Side terrain for a raised piece: a shoulder, then a cut face (up) or a fill slope (down) to a
 * bench at `bench`, then a slope to the ground. With bench null, the bench follows the road.
 */
function terrain(samples, bench) {
  const tris = [];
  const P = (s, l, y) => [s.x - Math.sin(s.h) * l, y, s.z + Math.cos(s.h) * l];
  const prof = (s, side) => {
    const ry = (s.y ?? 0) + surfaceY(side * ROAD_HALF, s.bank ?? 0) - 0.02;
    const by = bench ?? s.y ?? 0;
    const w = ROAD_HALF;
    return [
      [w, ry],
      [w + 0.3, ry],
      [w + 1.3, by],
      [w + 1.3 + Math.max(0.5, by * 1.6), 0],
    ];
  };
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-4) continue;
    for (const side of [-1, 1]) {
      const pa = prof(a, side);
      const pb = prof(b, side);
      for (let k = 0; k < 3; k++) {
        let color = '#9cc47a';
        if (k === 0) color = '#d9d2bc';
        if (k === 1) color = pa[2][1] > pa[1][1] + 0.06 ? '#c9a26b' : pa[2][1] < pa[1][1] - 0.06 ? '#b5cf8a' : '#a6cf7f';
        const A0 = P(a, side * pa[k][0], pa[k][1]);
        const A1 = P(a, side * pa[k + 1][0], pa[k + 1][1]);
        const B0 = P(b, side * pb[k][0], pb[k][1]);
        const B1 = P(b, side * pb[k + 1][0], pb[k + 1][1]);
        tris.push([A0, A1, B1, color], [A0, B1, B0, color]);
      }
    }
  }
  return coloredMesh(tris);
}

/** A yellow warning sign with short text. */
function warnSign(parent, x, z, h, text) {
  const g = signGroup(parent, x, z, h);
  box(g, [0.34, 0.34, 0.025], [0, 0.78, 0], '#f6c21a', [0, 0, Math.PI / 4]);
  label(g, text, 0.34, 0.13, [0, 0.78, 0.016], '#1c1c1e', '#f6c21a');
  return g;
}

function buildRidge({ piece, j, path, g, pops, base }) {
  const G = GEOMETRY.ridge;
  const Lv = clamp(G.Lv * j.rv, 1.2, G.length - 0.6);
  const v = vcurve(base, G.length, G.g, Lv);
  straightProfile(path, G.length, v.f);
  const s0 = path.pts[0];
  const sg = at(s0.x, s0.z, s0.h, 0.5, ROAD_HALF + 0.3);
  pops.push(warnSign(g, sg.x, sg.z, s0.h, 'HILL'));
  const top = { ...at(s0.x, s0.z, s0.h, G.length / 2), y: v.f(G.length / 2) };
  if (j.flaw) setFlaw(piece, top, 'Crest hides cars');
  piece.drive = { kind: 'ridge', stopped: at(s0.x, s0.z, s0.h, G.stopAt) };
}

function buildUnderpass({ piece, j, path, g, pops, base }) {
  const G = GEOMETRY.underpass;
  const Lv = clamp(G.Lv * j.rv, 1.6, G.length - 0.6);
  const v = vcurve(base, G.length, -G.g, Lv);
  straightProfile(path, G.length, v.f);
  const s0 = path.pts[0];
  // The bridge over the low point carries a cross road at the base level.
  const mid = at(s0.x, s0.z, s0.h, G.length / 2);
  const br = group(g, [mid.x, 0, mid.z]);
  br.rotation.y = -s0.h;
  box(br, [1.1, 0.16, 4.6], [0, 0.17, 0], '#c9c5bb');
  box(br, [1.12, 0.03, 4.6], [0, 0.265, 0], '#8f949b');
  for (const sx of [-1, 1]) box(br, [0.06, 0.14, 4.6], [sx * 0.52, 0.34, 0], '#e4e1d8');
  for (const sz of [-1, 1]) box(br, [1.1, base + 0.09, 0.3], [0, (0.09 - base) / 2, sz * (ROAD_HALF + 0.32)], '#d6d2c8');
  for (let k = -3; k <= 3; k++) box(br, [0.04, 0.012, 0.3], [0, 0.285, k * 0.6], '#ffffff');
  pops.push(br);
  // Debris on the road past the low point. It glows when the headlights reach it.
  const dp = at(s0.x, s0.z, s0.h, G.debrisAt, 0.25);
  const debris = group(g, [dp.x, v.f(G.debrisAt) - base + 0.05, dp.z]);
  debris.rotation.y = -s0.h + 0.3;
  const mats = ['#8c6a4a', '#6d6f73', '#a5805c'].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  [[0.42, 0.14, 0.18], [0.2, 0.2, 0.2], [0.28, 0.1, 0.3]].forEach((s, i) => {
    const m = box(debris, s, [(i - 1) * 0.12, s[1] / 2, (i - 1) * 0.1], '#8c6a4a', [0, i * 0.7, 0]);
    m.material = mats[i];
  });
  pops.push(debris);
  const reach = clamp(G.reach * Math.sqrt(Lv / G.Lv), 1.2, 8);
  const low = { ...mid, y: v.f(G.length / 2) };
  if (j.flaw) setFlaw(piece, low, 'Headlights too short');
  piece.drive = {
    kind: 'underpass',
    stopped: at(s0.x, s0.z, s0.h, G.debrisAt),
    reach,
    speed: G.speed,
    debris,
    lit: (on) => mats.forEach((m) => m.emissive.set(on ? '#7a5a14' : '#000000')),
  };
}

function buildHill({ piece, q, out, path, base }) {
  const G = GEOMETRY.hill;
  const crest = (q.figure?.curve ?? 'crest') === 'crest';
  const v = vcurve(base, G.length, crest ? G.g : -G.g, G.Lv);
  let y = v.f;
  const breaks = [];
  const kinks = [];
  let s = 0;
  const s0 = path.last();
  const wrong = !out.correct && !out.skipped && q.answer != null && out.value != null && Number.isFinite(out.value);
  if (wrong && q.answerType === 'station') {
    // A wrong station moves the curve along the road: it does not meet its tangents (two steps).
    let shift = stationShift(q, out, { shiftMin: 0.35, shiftMax: G.shiftMax });
    shift = clamp(shift, 0.3 - v.pvc, G.length - 0.3 - v.pvt);
    y = (d) => (d >= v.pvc + shift && d <= v.pvt + shift ? v.f(d - shift) : v.tangent(d));
    breaks.push(v.pvc + shift, v.pvt + shift);
    s = clamp(Math.abs(shift) / G.shiftMax, 0.25, 1);
  } else if (wrong) {
    // A wrong elevation makes a bump (or a dip) at the point.
    const err = out.value - q.answer;
    const amp = Math.sign(err) * clamp(0.08 + 0.07 * Math.log10(Math.max(1, Math.abs(err) / 0.1)), 0.08, 0.4);
    const dB = v.pvi;
    y = (d) => v.f(d) + amp * Math.exp(-(((d - dB) / 0.45) ** 2));
    breaks.push(dB);
    piece.bump = true;
    s = clamp(Math.abs(amp) / 0.4, 0.25, 1);
  }
  straightProfile(path, G.length, y, wrong && !piece.bump ? breaks : []);
  for (const d of breaks) kinks.push({ ...at(s0.x, s0.z, s0.h, d), y: y(d) });
  if (wrong) setFlaw(piece, kinks[0], piece.bump ? 'Bump in the road' : 'Step in the road');
  piece.drive = { kind: 'river', kinks, s };
}

function buildDownhill(ctx) {
  const { q, j, path, base } = ctx;
  const G = GEOMETRY.downhill;
  const S0 = GEOMETRY.stop;
  const z = zoneLengths(q, j, S0.sight, Infinity);
  const hazardAt = S0.before + S0.gap + Math.max(z.rb + z.bb, S0.sight);
  const G0 = q.figure?.G ?? -0.05;
  const gradeLen = hazardAt + 0.6;
  let gv = Math.sign(G0 || -1) * clamp(Math.abs(G0) * 1.6, G.gradeMin, G.gradeMax);
  if (Math.abs(gv) * gradeLen > G.rise) gv = (Math.sign(gv) * G.rise) / gradeLen;
  const g0 = 0.6;
  const yEnd = base + gv * (gradeLen - 0.4);
  const total = g0 + gradeLen + G.back;
  const y = (d) => {
    if (d <= g0) return base;
    const u = d - g0;
    if (u <= gradeLen) return base + gv * (u <= 0.8 ? (u * u) / 1.6 : u - 0.4);
    const t = clamp((u - gradeLen) / G.back, 0, 1);
    return yEnd + (base - yEnd) * (1 - Math.cos(Math.PI * t)) / 2;
  };
  straightProfile(path, total, y);
  const s0 = path.pts[0];
  const gs = at(s0.x, s0.z, s0.h, 0.3, ROAD_HALF + 0.3);
  ctx.pops.push(warnSign(ctx.g, gs.x, gs.z, s0.h, `${G0 < 0 ? '\u2212' : '+'}${Math.round(Math.abs(G0) * 100)}%`));
  stopScene(ctx, s0, hazardAt, z, (d) => y(d) - base);
}

/** The split of the right SSD into the reaction part and the braking part, from the question. */
function ssdShare(q) {
  const V = q.figure?.V ?? 50;
  const S = q.figure?.S ?? 1.47 * V * 2.5 * 2;
  return clamp((1.47 * V * 2.5) / S, 0.15, 0.85);
}

/**
 * The cleared sight zone in world units: the right react and brake lengths (rw, bw) for the
 * right total `sight`, and the built ones (rb, bb). The answer sets the asked part; a full
 * question (the SSD) sets both. The part not asked keeps the right value.
 */
function zoneLengths(q, j, sight, maxRatio) {
  const share = ssdShare(q);
  const rw = sight * share;
  const bw = sight - rw;
  const k = Math.min(j.rv, maxRatio);
  const ask = q.figure?.ask;
  if (ask === 'reaction') return { rw, bw, rb: rw * k, bb: bw };
  if (ask === 'braking') return { rw, bw, rb: rw, bb: bw * k };
  return { rw, bw, rb: rw * k, bb: bw * k };
}

/**
 * The painted zone: a yellow REACT bar, then an orange BRAKE bar, in the right lane.
 * The labels lie flat on the bars. main.js turns them each frame, so they read the right way up
 * from the camera at both screen shapes (piece.camLabels).
 */
function paintZone(parent, s0, start, z, yOf, labels) {
  const zone = group(parent, [s0.x, 0, s0.z]);
  zone.rotation.y = -s0.h;
  const bar = (from, len, color, text) => {
    const mid = from + len / 2;
    const slope = (yOf(mid + 0.05) - yOf(mid - 0.05)) / 0.1;
    const b = group(zone, [mid, yOf(mid) + 0.062, 0.3]);
    b.rotation.z = Math.atan(slope);
    const m = box(b, [len, 0.01, 0.5], [0, 0, 0], color);
    m.castShadow = false;
    const w = Math.min(0.55, len * 0.9);
    const p = at(s0.x, s0.z, s0.h, mid, 0.3);
    const t = label(parent, text, w, w * 0.26, [p.x, yOf(mid) + 0.075 + Math.abs(slope) * 0.3, p.z], '#1c1c1e', color);
    t.rotation.order = 'YXZ';
    t.rotation.x = -Math.PI / 2;
    labels.push(t);
  };
  bar(start, z.rb, '#f6c21a', 'REACT');
  bar(start + z.rb, z.bb, '#f08a5d', 'BRAKE');
  return zone;
}

/**
 * The stop scene: the STOP AHEAD sign at the start of the zone, the zone, the STOP sign and the
 * rocks. The car sees the hazard at the start of the zone and stops with the right values, so
 * its front stops at the end of the right zone. yOf(d): the road height above the base.
 */
function stopScene({ piece, j, q, g, pops, rng }, s0, hazardAt, z, yOf = () => 0) {
  const G = GEOMETRY.stop;
  const zoneEnd = hazardAt - G.gap;
  const zoneStart = zoneEnd - (z.rb + z.bb);
  const up = (grp, d) => {
    grp.position.y = yOf(d);
    return grp;
  };
  const sg = at(s0.x, s0.z, s0.h, zoneStart, ROAD_HALF + 0.3);
  pops.push(up(stopAheadSign(g, sg.x, sg.z, s0.h), zoneStart));
  const st = at(s0.x, s0.z, s0.h, hazardAt - 0.45, ROAD_HALF + 0.3);
  pops.push(up(stopSign(g, st.x, st.z, s0.h), hazardAt - 0.45));
  piece.camLabels = [];
  pops.push(paintZone(g, s0, zoneStart, z, yOf, piece.camLabels), ...piece.camLabels);
  // The hazard: fallen rocks across the right lane.
  const hz = { ...at(s0.x, s0.z, s0.h, hazardAt), y: yOf(hazardAt) + (piece.baseY ?? 0) };
  const rocks = group(g, [hz.x, yOf(hazardAt) + 0.05, hz.z]);
  rocks.rotation.y = -s0.h;
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const size = 0.24 + rng() * 0.16;
    parts.push(box(rocks, [size, size * 0.8, size], [(rng() - 0.5) * 0.3, size * 0.4, -0.1 + i * 0.16], i % 2 ? '#8c6a4a' : '#a5805c', [rng(), rng(), rng()]));
  }
  for (const m of parts) m.userData.home = { p: m.position.clone(), r: m.rotation.clone() };
  pops.push(rocks);
  const ask = q.figure?.ask;
  if (j.flaw) setFlaw(piece, hz, ask === 'reaction' ? 'React zone too short' : ask === 'braking' ? 'Brake zone too short' : 'Warning too late');
  piece.drive = {
    kind: 'stop',
    hazard: hz,
    sign: at(s0.x, s0.z, s0.h, zoneStart),
    react: z.rw,
    brake: z.bw,
    s: j.s,
    rocks,
    parts,
    ground: hz.y,
  };
}

/** The road climbs from the flat ground into the hills (no question). */
function buildClimb({ piece, path, start }) {
  const L = GEOMETRY.climb.length;
  const y0 = start.y ?? 0;
  const y1 = GEOMETRY.base;
  straightProfile(path, L, (d) => y0 + (y1 - y0) * (1 - Math.cos((Math.PI * d) / L)) / 2);
  piece.drive = null;
}

// ---------- The bend around a building (H3) ----------

/** A small blocky building. It stands along heading h: w along, d across. */
function house(parent, x, z, h, w, d) {
  const g = group(parent, [x, 0, z]);
  g.rotation.y = -h;
  box(g, [w, 0.55, d], [0, 0.275, 0], '#f2efe7');
  box(g, [w + 0.08, 0.1, d + 0.08], [0, 0.6, 0], '#c8342f');
  box(g, [w * 0.7, 0.12, d * 0.7], [0, 0.71, 0], '#b02e29');
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) box(g, [0.18, 0.14, 0.02], [sx * w * 0.25, 0.33, sz * (d / 2 + 0.006)], '#8ec5ea');
  }
  box(g, [0.02, 0.26, 0.16], [w / 2 + 0.006, 0.13, 0], '#55341d');
  return g;
}

/**
 * The bend around a building. The answer (M, E, or LC) sets the built curve. A wrong value in
 * either direction is a flaw.
 * M: the building is on the long chord midpoint. PC and PT stay on the chord; M sets the bulge.
 * E: the building is near the PI on the bisector. E sets the radius; the tangent points move.
 * LC: the crew stakes the PT from the PC along the chord at Δ/2; a wrong LC misses the forward tangent.
 */
function buildBuilding({ piece, q, out, path, g, pops, avoid, turn }) {
  const G = GEOMETRY.building;
  const ask = q.figure?.ask ?? 'M';
  const D = G.delta * DEG;
  const delta = D * turn;
  const s0 = path.last();
  const h0 = s0.h;
  const h1 = h0 + delta;
  const chordH = h0 + delta / 2;
  const wrong = !out.correct && !out.skipped && out.value != null && Number.isFinite(out.value) && q.answer != null;
  let ratio = wrong ? out.value / q.answer : 1;
  if (!(ratio > 0)) ratio = GEOMETRY.ratioMin;
  const nudge = (r, lo, hi) => {
    let k = clamp(r, lo, hi);
    if (wrong && Math.abs(k - 1) < 0.1) k = 1 + Math.sign(r - 1 || 1) * 0.1;
    return k;
  };
  const kinks = [];
  let hitAt = null;
  let flawPoint = null;
  let bld;
  let name = '';
  if (ask === 'M') {
    const R0 = G.mR;
    const LC0 = 2 * R0 * Math.sin(D / 2);
    const M0 = R0 * (1 - Math.cos(D / 2));
    path.straight(G.tanIn);
    const pc = { ...path.last() };
    const mid = at(pc.x, pc.z, chordH, LC0 / 2);
    // The building stands on the chord midpoint. Its face is a gap inside the right road edge.
    const depth = 1.1;
    const face = M0 - ROAD_HALF - G.gap;
    const bc = at(mid.x, mid.z, chordH, 0, -turn * (face - depth / 2));
    bld = house(g, bc.x, bc.z, chordH, 1.4, depth);
    if (!wrong) {
      path.arc(R0, delta);
    } else {
      const k = nudge(ratio, 0.3, 2.2);
      const Mb = Math.min(M0 * k, 0.45 * LC0);
      const Rb = (LC0 * LC0) / 4 / (2 * Mb) + Mb / 2;
      const phi = 2 * Math.asin(Math.min(1, LC0 / (2 * Rb)));
      kinks.push({ x: pc.x, z: pc.z });
      path.turnTo(chordH - (turn * phi) / 2);
      path.arc(Rb, turn * phi);
      const pt = path.last();
      kinks.push({ x: pt.x, z: pt.z });
      path.turnTo(h1);
      if (Mb - ROAD_HALF < face) hitAt = at(mid.x, mid.z, chordH, 0, -turn * Mb);
      name = k < 1 ? 'Road clips the building (M)' : 'Road swings wide (M)';
    }
    path.straight(G.tanOut);
  } else if (ask === 'E') {
    const R0 = G.eR;
    const T0 = R0 * Math.tan(D / 2);
    const E0 = R0 * (1 / Math.cos(D / 2) - 1);
    const pi = at(s0.x, s0.z, h0, G.tanIn + T0);
    // The building stands at the PI on the bisector, a gap outside the right road edge.
    const depth = 0.9;
    const face = E0 - ROAD_HALF - G.gap;
    const bc = at(pi.x, pi.z, chordH, 0, turn * (face - depth / 2));
    bld = house(g, bc.x, bc.z, chordH, 1.1, depth);
    // The stakes of the right PC and PT.
    for (const [p, h] of [
      [at(s0.x, s0.z, h0, G.tanIn), h0],
      [at(pi.x, pi.z, h1, T0), h1],
    ]) {
      const sp = at(p.x, p.z, h, 0, -turn * (ROAD_HALF + 0.3));
      pops.push(stake(g, sp.x, sp.z, true));
    }
    const k = wrong ? nudge(ratio, 0.3, (G.tanIn + T0 - 0.3) / T0) : 1;
    const Rb = R0 * k;
    const Tb = T0 * k;
    path.straight(G.tanIn + T0 - Tb);
    const pcb = { ...path.last() };
    path.arc(Rb, delta);
    path.straight(T0 + G.tanOut - Tb);
    if (wrong) {
      const Eb = E0 * k;
      if (Eb - ROAD_HALF < face) hitAt = at(pi.x, pi.z, chordH, 0, turn * Eb);
      // A large E: the curve is smooth, but its tangent points are not on the stakes.
      else flawPoint = { x: pcb.x, z: pcb.z };
      name = k < 1 ? 'Road through the building (E)' : 'Tangent points moved (E)';
    }
  } else {
    // LC: the crew sights the PT from the PC at Δ/2 and stakes it at the answer.
    const R0 = G.lcR;
    const LC0 = 2 * R0 * Math.sin(D / 2);
    path.straight(G.tanIn);
    const pc = { ...path.last() };
    const pt0 = at(pc.x, pc.z, chordH, LC0);
    const mid = at(pc.x, pc.z, chordH, LC0 / 2);
    const bc = at(mid.x, mid.z, chordH, 0, turn * 0.9);
    bld = house(g, bc.x, bc.z, chordH, 1.0, 0.8);
    const k = wrong ? nudge(ratio, 0.5, 1.35) : 1;
    const LCb = LC0 * k;
    path.arc(LCb / (2 * Math.sin(D / 2)), delta);
    const ptb = { ...path.last() };
    // The sight line from the PC to the PT stake.
    const lm = at(pc.x, pc.z, chordH, LCb / 2);
    const line = box(g, [LCb, 0.008, 0.04], [lm.x, 0.066, lm.z], '#ff7a1a', [0, -chordH, 0]);
    line.castShadow = false;
    pops.push(line);
    const sp = at(ptb.x, ptb.z, h1, 0, -turn * (ROAD_HALF + 0.25));
    pops.push(stake(g, sp.x, sp.z, true));
    if (wrong) {
      kinks.push({ x: ptb.x, z: ptb.z });
      const alongA = (ptb.x - pt0.x) * Math.cos(h1) + (ptb.z - pt0.z) * Math.sin(h1);
      const alongQ = Math.min(Math.max(alongA, 0) + 0.5, G.tanOut - 0.25);
      const q2 = at(pt0.x, pt0.z, h1, alongQ);
      path.lineTo(q2.x, q2.z);
      kinks.push({ x: q2.x, z: q2.z });
      path.turnTo(h1);
      path.straight(G.tanOut - alongQ);
      name = k < 1 ? 'PT stake short (LC)' : 'PT stake long (LC)';
    } else {
      path.straight(G.tanOut);
    }
  }
  pops.push(bld);
  avoid.push({ x: bld.position.x, z: bld.position.z, r: 1.3 });
  if (hitAt) {
    // The road cuts into the building.
    bld.rotation.z = 0.12 * turn;
    kinks.push(hitAt);
  }
  if (wrong) setFlaw(piece, hitAt ?? flawPoint ?? kinks[0], name);
  piece.drive = { kind: 'river', kinks, s: wrong ? clamp(Math.abs(ratio - 1) / 0.6, 0.3, 1) : 0 };
  // An M flaw is about the building, so the ring of the drive marks the building (over its roof).
  if (wrong && ask === 'M') piece.drive.ringAt = { x: bld.position.x, y: (piece.baseY ?? 0) + 0.75, z: bld.position.z };
}

const BUILDERS = {
  stake: buildStake,
  river: buildRiver,
  curve: buildCurve,
  fast: buildFast,
  cut: buildCut,
  bank: buildBank,
  stop: buildStop,
  plain: buildPlain,
  ridge: buildRidge,
  underpass: buildUnderpass,
  hill: buildHill,
  downhill: buildDownhill,
  climb: buildClimb,
  building: buildBuilding,
};

function setFlaw(piece, at, name) {
  piece.flaw = true;
  piece.flawAt = { x: at.x, y: at.y, z: at.z };
  piece.flawName = name;
}

/** A green RAMP sign at the start ('start') or the end ('end') of a whole ramp. */
export function addRampSign(piece, which) {
  if (which === 'start') {
    const s = piece.samples[0];
    const a = at(s.x, s.z, s.h, 0.4, ROAD_HALF + 0.35);
    piece.pops.push(rampSign(piece.group, a.x, a.z, s.h, 'RAMP'));
    return;
  }
  // The end sign stands on the right, clear of the eagle spot on the left.
  const e = piece.samples[piece.samples.length - 1];
  const b = at(e.x, e.z, e.h, -0.8, ROAD_HALF + 0.35);
  piece.pops.push(rampSign(piece.group, b.x, b.z, e.h, 'RAMP'));
}

// ---------- Verdict text ----------

const EVENTS = {
  river: { title: 'Kink', text: 'The curve does not meet its tangents. A car jolts at the kink.' },
  curve: { title: 'Kink', text: 'The ramp curve is out of line. A car jolts as it goes over the flaw.' },
  fast: { title: 'Skid', text: 'The bend is too sharp for the design speed. The car skids off.' },
  cut: { title: 'Late hard brake', text: 'The slope hides the stopped car. The driver sees it late and brakes hard.' },
  bank: { title: 'Rocking', text: 'The bank changes too fast. The car rocks as it goes in and out of the bend.' },
  stop: { title: 'Cannot stop', text: 'The warning comes too late. The car cannot stop before the rocks.' },
  downhill: { title: 'Cannot stop', text: 'The warning comes too late on the grade. The car cannot stop before the rocks.' },
  ridge: { title: 'Late hard brake', text: 'The crest hides the stopped car. The driver sees it late and brakes hard.' },
  underpass: { title: 'Headlights too short', text: 'At night the headlights do not reach the debris in time. The driver brakes late.' },
  hill: { title: 'Step', text: 'The profile does not meet itself. A car jolts at the step.' },
  building: { title: 'Curve off line', text: 'The curve does not fit the building and its tangents.' },
};

function verdict(typeId, q, out, j, piece) {
  if (out.skipped) return { tone: 'clean', title: 'Change Order', text: 'The question is skipped. The crew builds the right geometry at no cost.' };
  if (typeId === 'stake') {
    return out.correct
      ? { tone: 'clean', title: 'Stake set', text: 'The survey stake is in the right place.' }
      : { tone: 'flaw', title: 'Wrong stake', text: 'The stake is in the wrong place. A stake sets no geometry, so the road is the same. The wrong answer costs the damage.' };
  }
  const line = builtLine(q, out);
  if (out.correct) return { tone: 'clean', title: 'Clean drive', text: `${line} The car drives it clean.` };
  if (piece.flaw) {
    const ev = EVENTS[typeId];
    let title = typeId === 'curve' && piece.variant === 'M' ? 'Wobble' : piece.bump ? 'Bump' : ev.title;
    if (typeId === 'river' && piece.flawName.startsWith('Step')) title = 'Step';
    // The building bend and the zone of the stop name the flaw itself.
    if (typeId === 'building' || (typeId === 'stop' && piece.flawName !== 'Warning too late')) title = piece.flawName.replace(/ \(.*\)$/, '');
    const zoneText = {
      'React zone too short': 'The react zone is too short. The car reacts in the right time and brakes with the right deceleration, so it cannot stop before the rocks.',
      'Brake zone too short': 'The brake zone is too short. The car brakes with the right deceleration, so it cannot stop before the rocks.',
    };
    const text = typeId === 'river' && piece.flawName.startsWith('Step')
      ? 'The curve starts at the wrong point. It leaves the back tangent smoothly but misses the forward tangent: a step at the exit.'
      : (zoneText[piece.flawName] ?? ev.text);
    return { tone: 'flaw', title, text: `${line} ${text} The flaw stays in the road until a rework.` };
  }
  return {
    tone: 'earth',
    title: 'Extra earthwork',
    text: `${line} The design is safe but too large (${Math.round(j.r * 100)}% of the need). The extra earthwork costs the damage now.`,
  };
}
