// The question generators and the concept questions. No DOM.
// Content rules: ../CONTENT.md. The contract: ../BRIEF.md, "questions.js".
import * as F from './formulas.js';

export const TIME_LIMITS = { quick: 60, step: 120, full: 240, exam: 360 };

/** AASHTO maximum side friction factor by design speed (GDHS 2018 Table 3-7, through [S6]). */
const F_MAX = { 30: 0.2, 35: 0.18, 40: 0.16, 45: 0.15, 50: 0.14, 55: 0.13, 60: 0.12, 65: 0.11, 70: 0.1, 75: 0.09, 80: 0.08 };
/** AASHTO maximum relative gradient in percent by design speed (through [S7]). */
const REL_GRADIENT = { 30: 0.66, 35: 0.62, 40: 0.58, 45: 0.54, 50: 0.5, 55: 0.47, 60: 0.45, 65: 0.43, 70: 0.4, 75: 0.38 };
/** AASHTO adjustment factor b_w by the number of lanes rotated (through [S7]). */
const BW = { 1: 1.0, 1.5: 0.83, 2: 0.75 };
/** AASHTO passing sight distance by design speed (GDHS 2018). */
const PSD = { 30: 500, 35: 550, 40: 600, 45: 700, 50: 800, 55: 900, 60: 1000, 65: 1100, 70: 1200 };
/** AASHTO design K for crest curves, stopping sight distance (GDHS 2018 as quoted in [S3]). */
const CREST_K = { 30: 19, 35: 29, 40: 44, 45: 61, 50: 84, 55: 114, 60: 151, 65: 193, 70: 247 };
/** AASHTO design K for sag curves, headlight criterion (GDHS 2018 as quoted in [S3]). */
const SAG_K = { 30: 37, 35: 49, 40: 64, 45: 79, 50: 96, 55: 115, 60: 136, 65: 157, 70: 181 };

// ---------- Answers ----------

/** The tolerance for each answer type (CONTENT.md, "Answers"). */
const TOLERANCE = {
  length: { rel: 0.01 },
  speed: { rel: 0.01 },
  angle: { rel: 0.01 },
  station: { abs: 1.0 },
  elevation: { abs: 0.1 },
  percent: { abs: 0.1 },
  fraction: { abs: 0.001 },
};

function tolerance(type, answer) {
  const t = TOLERANCE[type];
  return t.abs ?? Math.abs(answer) * t.rel;
}

export function parseAnswer(question, text) {
  if (question.answerType === 'station') return F.parseStation(text);
  const s = String(text).trim().replace(/,/g, '').replace(/[−–]/g, '-');
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : null;
}

export function checkAnswer(question, value) {
  if (question.answer == null || value == null || !Number.isFinite(value)) return false;
  return Math.abs(value - question.answer) <= tolerance(question.answerType, question.answer) + 1e-9;
}

const DIGITS = { length: 1, speed: 1, angle: 2, station: 2, elevation: 2, percent: 2, fraction: 3 };

export function formatValue(question, value) {
  if (value == null) return '';
  const type = question.answerType;
  if (type === 'station') return F.formatStation(value);
  const digits = type === 'length' && Math.abs(value) < 100 ? 2 : DIGITS[type];
  const text = num(value, digits);
  if (!question.unit) return text;
  return question.unit === '%' || question.unit === '°' ? `${text}${question.unit}` : `${text} ${question.unit}`;
}

// ---------- Text helpers ----------

/** A number with thousands separators and a fixed count of decimals. */
function num(x, digits = 2) {
  return x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
const ft = (x, d = 2) => `${num(x, d)} ft`;
const sta = (x) => F.formatStation(x);
const pct = (g) => `${g >= 0 ? '+' : '−'}${num(Math.abs(g * 100), 1)}%`;
/** A decimal with a true minus sign, for example −0.040. */
const dec = (x, d) => `${x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}`;
/** A term to add, for example "+ 6.00" or "− 2.25". */
const term = (x, d = 2) => `${x < 0 ? '−' : '+'} ${num(Math.abs(x), d)}`;
/** Degrees and minutes, for example 16°30′. */
function dms(deg, min) {
  return min ? `${deg}°${String(min).padStart(2, '0')}′` : `${deg}°`;
}
const roundTo = (x, step) => Math.round(x / step) * step;

// ---------- Choices ----------

/**
 * Three wrong options from the typical mistakes, plus the right one, shuffled.
 * Each wrong option is more than 2 times the tolerance from the answer and from the other options.
 * Returns null if fewer than 3 mistakes qualify; the caller then makes new inputs.
 */
function numericChoices(rng, q, mistakes) {
  const gap = 2 * tolerance(q.answerType, q.answer);
  const valid = mistakes.filter((m) => Number.isFinite(m.value) && plausible(q.answerType, m.value));
  const picked = [];
  for (const m of rng.shuffle(valid)) {
    if (Math.abs(m.value - q.answer) <= gap) continue;
    if (picked.some((p) => Math.abs(p.value - m.value) <= gap)) continue;
    picked.push(m);
    if (picked.length === 3) break;
  }
  if (picked.length < 3) return null;
  const options = [
    { value: q.answer, correct: true, why: '' },
    ...picked.map((m) => ({ value: m.value, correct: false, why: m.why })),
  ];
  return rng.shuffle(options).map((o) => ({ ...o, text: formatValue(q, o.value) }));
}

function plausible(type, v) {
  if (type === 'elevation') return true;
  if (type === 'fraction') return v > 0 && v < 1;
  return v > 0;
}

// ---------- Generators ----------
// Each generator: { id, title, topic, stage, kinds, asks: { kind: [ask, ...] }, inputs(rng, ctx), build(inputs, ask) }.
// build() returns the question body and `mistakes` ([{ value, why }]).

const H1 = {
  id: 'H1',
  title: 'Degree of curve',
  topic: 'horizontal',
  stage: 1,
  kinds: ['quick'],
  asks: { quick: ['R', 'D'] },
  inputs(rng) {
    return { deg: rng.int(1, 12), min: rng.pick([0, 15, 30, 45]), R: rng.int(10, 100) * 50 };
  },
  build({ deg, min, R: givenR }, ask) {
    if (ask === 'R') {
      const D = deg + min / 60;
      const R = F.radiusFromDegree(D);
      return {
        prompt: `A horizontal curve has a degree of curve of ${dms(deg, min)} (arc definition).\nWhat is the radius?`,
        answer: R,
        answerType: 'length',
        unit: 'ft',
        solution: [
          'Arc definition: D is the central angle of a 100 ft arc.',
          `D = ${dms(deg, min)} = ${num(D, 4)}°`,
          `R = 5729.58 / D = 5729.58 / ${num(D, 4)} = ${ft(R)}`,
        ],
        mistakes: [
          { value: 5729.58 * D, why: 'Multiplied by D in place of dividing.' },
          { value: 50 / Math.sin(D * (Math.PI / 180)), why: 'Used the chord formula 50 / sin(D/2), but with D in place of D/2.' },
          { value: 100 / D, why: 'Used R = 100 / D, as if D were in radians.' },
          { value: 2 * R, why: 'Left out the 2 in the circumference 2πR.' },
        ],
      };
    }
    const D = F.degreeFromRadius(givenR);
    return {
      prompt: `A horizontal curve has a radius of ${ft(givenR, 0)}.\nWhat is the degree of curve (arc definition), in degrees?`,
      answer: D,
      answerType: 'angle',
      unit: '°',
      solution: [
        'Arc definition: D is the central angle of a 100 ft arc.',
        `D = 5729.58 / R = 5729.58 / ${num(givenR, 0)} = ${num(D, 4)}°`,
      ],
      mistakes: [
        { value: givenR / 5729.58, why: 'Divided R by 5729.58 in place of the reverse.' },
        { value: 2864.79 / givenR, why: 'Used 90 in place of 180 in the constant (half the answer).' },
        { value: 11459.16 / givenR, why: 'Used 360 in place of 180 in the constant (twice the answer).' },
        { value: 100 / givenR, why: 'Used D = 100 / R, which gives radians, not degrees.' },
      ],
    };
  },
};

function curveInputs(rng) {
  const R = rng.int(10, 60) * 50;
  const deg = rng.int(10, 80);
  const min = rng.int(0, 59);
  const delta = deg + min / 60;
  const { T } = F.curveElements(R, delta);
  const pi = roundTo(T + 500 + rng() * 12000, 0.01);
  return { R, deg, min, delta, pi };
}

function curveGiven({ R, deg, min, pi }, withPi) {
  const lines = ['A circular horizontal curve has these values:'];
  if (withPi) lines.push(`PI station: ${sta(pi)}`);
  lines.push(`Radius R: ${ft(R, 0)}`, `Deflection angle Δ: ${dms(deg, min)}`);
  return lines.join('\n');
}

const H2 = {
  id: 'H2',
  title: 'Curve stations',
  topic: 'horizontal',
  stage: 1,
  kinds: ['full', 'step'],
  asks: { full: ['PC', 'PT'], step: ['T', 'L'] },
  inputs: curveInputs,
  build(inp, ask) {
    const { R, deg, min, delta, pi } = inp;
    const c = F.curveElements(R, delta);
    const half = (delta / 2) * (Math.PI / 180);
    const pc = pi - c.T;
    const pt = pc + c.L;
    const figure = { type: 'hcurve', R, delta, piStation: pi, ask };
    const stepD = `Δ = ${dms(deg, min)} = ${num(delta, 4)}°`;
    const stepT = `T = R tan(Δ/2) = ${num(R, 0)} × tan(${num(delta / 2, 4)}°) = ${ft(c.T)}`;
    const stepL = `L = πRΔ / 180 = π × ${num(R, 0)} × ${num(delta, 4)} / 180 = ${ft(c.L)}`;
    if (ask === 'T') {
      return {
        prompt: `${curveGiven(inp, false)}\nWhat is the tangent length T?`,
        answer: c.T,
        answerType: 'length',
        unit: 'ft',
        solution: [stepD, stepT],
        figure,
        mistakes: [
          { value: R * Math.tan(delta * (Math.PI / 180)), why: 'Used tan Δ in place of tan(Δ/2).' },
          { value: R * Math.sin(half), why: 'Used sine in place of tangent.' },
          { value: 2 * c.T, why: 'Doubled T. Each tangent is R tan(Δ/2).' },
          { value: c.M, why: 'That is the middle ordinate M.' },
        ],
      };
    }
    if (ask === 'L') {
      return {
        prompt: `${curveGiven(inp, false)}\nWhat is the length of the curve L?`,
        answer: c.L,
        answerType: 'length',
        unit: 'ft',
        solution: [stepD, stepL],
        figure,
        mistakes: [
          { value: R * delta, why: 'Used L = RΔ with Δ in degrees, not radians.' },
          { value: (Math.PI * R * delta) / 360, why: 'Used 360 in place of 180.' },
          { value: 2 * c.T, why: 'Used 2T. The curve is shorter than the two tangents.' },
          { value: c.LC, why: 'That is the long chord, not the arc length.' },
        ],
      };
    }
    const pcSteps = [stepD, stepT, `PC = PI − T = ${sta(pi)} − ${num(c.T, 2)} = ${sta(pc)}`];
    if (ask === 'PC') {
      return {
        prompt: `${curveGiven(inp, true)}\nWhat is the station of the PC?`,
        answer: pc,
        answerType: 'station',
        unit: '',
        solution: pcSteps,
        figure,
        mistakes: [
          { value: pi - c.L / 2, why: 'Used L/2 in place of T.' },
          { value: pi - R * Math.tan(delta * (Math.PI / 180)), why: 'Used tan Δ in place of tan(Δ/2).' },
          { value: pi + c.T, why: 'Added T. The PC comes before the PI.' },
          { value: pi - c.LC / 2, why: 'Used half the long chord in place of T.' },
        ],
      };
    }
    return {
      prompt: `${curveGiven(inp, true)}\nWhat is the station of the PT?`,
      answer: pt,
      answerType: 'station',
      unit: '',
      solution: [...pcSteps, stepL, `PT = PC + L = ${sta(pc)} + ${num(c.L, 2)} = ${sta(pt)}`],
      figure,
      mistakes: [
        { value: pi + c.T, why: 'Used PT = PI + T. Stations run along the curve, so PT = PC + L.' },
        { value: pi + c.L / 2, why: 'Used L/2 in place of T to find the PC.' },
        { value: pc + R * delta, why: 'Used L = RΔ with Δ in degrees, not radians.' },
        { value: pc + c.LC, why: 'Added the long chord, not the arc length.' },
        { value: pi - R * Math.tan(delta * (Math.PI / 180)) + c.L, why: 'Used tan Δ in place of tan(Δ/2) for T.' },
      ],
    };
  },
};

const H3 = {
  id: 'H3',
  title: 'Curve offsets',
  topic: 'horizontal',
  stage: 1,
  kinds: ['step'],
  asks: { step: ['M', 'E', 'LC'] },
  inputs: curveInputs,
  build(inp, ask) {
    const { R, deg, min, delta } = inp;
    const c = F.curveElements(R, delta);
    const half = (delta / 2) * (Math.PI / 180);
    const full = delta * (Math.PI / 180);
    const figure = { type: 'hcurve', R, delta, piStation: inp.pi, ask };
    const stepD = `Δ/2 = ${num(delta / 2, 4)}°`;
    if (ask === 'M') {
      return {
        prompt: `${curveGiven(inp, false)}\nWhat is the middle ordinate M?`,
        answer: c.M,
        answerType: 'length',
        unit: 'ft',
        solution: [stepD, `M = R(1 − cos(Δ/2)) = ${num(R, 0)} × (1 − cos(${num(delta / 2, 4)}°)) = ${ft(c.M)}`],
        figure,
        mistakes: [
          { value: R * (1 - Math.cos(full)), why: 'Used Δ in place of Δ/2.' },
          { value: c.E, why: 'That is the external distance E.' },
          { value: R * (1 - Math.sin(half)), why: 'Used sine in place of cosine.' },
          { value: R * Math.cos(half), why: 'Left out the "1 −".' },
        ],
      };
    }
    if (ask === 'E') {
      return {
        prompt: `${curveGiven(inp, false)}\nWhat is the external distance E?`,
        answer: c.E,
        answerType: 'length',
        unit: 'ft',
        solution: [stepD, `E = R(1 / cos(Δ/2) − 1) = ${num(R, 0)} × (1 / cos(${num(delta / 2, 4)}°) − 1) = ${ft(c.E)}`],
        figure,
        mistakes: [
          { value: R * (1 / Math.cos(full) - 1), why: 'Used Δ in place of Δ/2.' },
          { value: c.M, why: 'That is the middle ordinate M.' },
          { value: R / Math.cos(half), why: 'Left out the "− 1".' },
          { value: R * (1 / Math.sin(half) - 1), why: 'Used sine in place of cosine.' },
        ],
      };
    }
    return {
      prompt: `${curveGiven(inp, false)}\nWhat is the long chord LC?`,
      answer: c.LC,
      answerType: 'length',
      unit: 'ft',
      solution: [stepD, `LC = 2R sin(Δ/2) = 2 × ${num(R, 0)} × sin(${num(delta / 2, 4)}°) = ${ft(c.LC)}`],
      figure,
      mistakes: [
        { value: R * Math.sin(half), why: 'Left out the 2.' },
        { value: 2 * R * Math.sin(full), why: 'Used Δ in place of Δ/2.' },
        { value: 2 * c.T, why: 'Used 2T, the two tangents.' },
        { value: c.L, why: 'That is the arc length L.' },
      ],
    };
  },
};

const H4 = {
  id: 'H4',
  title: 'Radius and side friction',
  topic: 'horizontal',
  stage: 1,
  kinds: ['full'],
  asks: { full: ['R', 'f', 'V'] },
  inputs(rng) {
    const V = rng.int(6, 16) * 5;
    const e = rng.pick([4, 6, 8, 10, 12]);
    const f = F_MAX[V];
    const Rmin = F.minRadius(V, e, f);
    // For "f": a radius above the minimum, so the demand is below f_max.
    const Rf = Math.max(roundTo(Rmin * (1.05 + rng() * 0.6), 50), roundTo(Rmin, 50) + 50);
    // For "V": a radius away from the minimum, so the answer is not the design speed.
    const Rv = Math.max(50, roundTo(Rmin * (0.6 + rng() * 0.9), 10));
    return { V, e, f, Rmin, Rf, Rv };
  },
  build({ V, e, f, Rmin, Rf, Rv }, ask) {
    const sum = 0.01 * e + f;
    if (ask === 'R') {
      return {
        prompt: `Design speed: ${V} mph\nMaximum superelevation e_max: ${e}%\nMaximum side friction factor f_max: ${f.toFixed(2)}\nWhat is the minimum radius?`,
        answer: Rmin,
        answerType: 'length',
        unit: 'ft',
        solution: [
          '0.01e + f = V² / (15R), so R_min = V² / (15 (0.01e_max + f_max))',
          `0.01 × ${e} + ${f.toFixed(2)} = ${sum.toFixed(2)}`,
          `R_min = ${V}² / (15 × ${sum.toFixed(2)}) = ${ft(Rmin, 1)}`,
        ],
        figure: { type: 'superelevation', V, e, f, R: Rmin, ask },
        mistakes: [
          { value: V ** 2 / (15 * (e + f)), why: `Used e = ${e} in place of ${(e / 100).toFixed(2)} (e must be a decimal here).` },
          { value: V ** 2 / (127 * sum), why: 'Used the SI constant 127 with mph.' },
          { value: V / (15 * sum), why: 'Did not square V.' },
          { value: V ** 2 / (15 * f), why: 'Left out the superelevation e.' },
          { value: V ** 2 / (32.2 * sum), why: 'Used g = 32.2 without the mph to ft/s conversion (that gives 15).' },
        ],
      };
    }
    if (ask === 'f') {
      const fd = F.frictionDemand(V, Rf, e);
      // A very small f makes a strange question, and the 0.001 tolerance becomes too wide.
      if (fd < 0.02) return null;
      return {
        prompt: `A curve has a radius of ${ft(Rf, 0)} and a superelevation of ${e}%.\nDesign speed: ${V} mph\nWhat side friction factor f does a car need at the design speed?`,
        answer: fd,
        answerType: 'fraction',
        unit: '',
        solution: [
          '0.01e + f = V² / (15R), so f = V² / (15R) − 0.01e',
          `V² / (15R) = ${V}² / (15 × ${num(Rf, 0)}) = ${(V ** 2 / (15 * Rf)).toFixed(4)}`,
          `f = ${(V ** 2 / (15 * Rf)).toFixed(4)} − ${(0.01 * e).toFixed(2)} = ${fd.toFixed(3)}`,
        ],
        figure: { type: 'superelevation', V, e, f: fd, R: Rf, ask },
        mistakes: [
          { value: V ** 2 / (15 * Rf), why: 'Did not subtract e.' },
          { value: V ** 2 / (15 * Rf) + 0.01 * e, why: 'Added e in place of subtracting it.' },
          { value: V ** 2 / (127 * Rf) - 0.01 * e, why: 'Used the SI constant 127 with mph.' },
          { value: V ** 2 / (32.2 * Rf) - 0.01 * e, why: 'Used g = 32.2 without the mph to ft/s conversion.' },
          { value: (V * 1.47) ** 2 / (15 * Rf) - 0.01 * e, why: 'Converted V to ft/s. The constant 15 already does that.' },
        ],
      };
    }
    const Vmax = F.maxSpeed(Rv, e, f);
    return {
      prompt: `A curve has a radius of ${ft(Rv, 0)} and a superelevation of ${e}%.\nUse a side friction factor f of ${f.toFixed(2)}.\nWhat is the highest speed for these values?`,
      answer: Vmax,
      answerType: 'speed',
      unit: 'mph',
      solution: [
        '0.01e + f = V² / (15R), so V = √(15R (0.01e + f))',
        `V = √(15 × ${num(Rv, 0)} × ${sum.toFixed(2)}) = ${num(Vmax, 1)} mph`,
      ],
      figure: { type: 'superelevation', V: Vmax, e, f, R: Rv, ask },
      mistakes: [
        { value: Math.sqrt(15 * Rv * (e + f)), why: `Used e = ${e} in place of ${(e / 100).toFixed(2)}.` },
        { value: Math.sqrt(127 * Rv * sum), why: 'Used the SI constant 127 with mph.' },
        { value: 15 * Rv * sum, why: 'Did not take the square root.' },
        { value: Math.sqrt(15 * Rv * f), why: 'Left out the superelevation e.' },
        { value: Math.sqrt(15 * Rv * sum) / 1.47, why: 'Divided by 1.47. The constant 15 already gives mph.' },
      ],
    };
  },
};

const H5 = {
  id: 'H5',
  title: 'Sightline offset',
  topic: 'horizontal',
  stage: 1,
  kinds: ['full'],
  asks: { full: ['lane', 'road'] },
  inputs(rng) {
    const V = rng.int(6, 14) * 5;
    const S = F.designSSD(F.ssdLevel(V));
    const R = Math.max(roundTo(S * (0.8 + rng() * 2.2), 50), 400);
    // The curve must be longer than S (the limit of the formula).
    const Lmin = S * 1.15;
    const L = roundTo(Lmin + rng() * S, 10);
    return { V, S, R, L };
  },
  build({ V, S, R: Rgiven, L }, ask) {
    const road = ask === 'road';
    // A road question gives the road centerline radius. The inside lane centerline is half a lane (6 ft) inside it.
    const R = road ? Rgiven - 6 : Rgiven;
    const angle = (28.65 * S) / R;
    const hso = F.sightlineOffset(R, S);
    const given = road
      ? `A two-lane road has a horizontal curve with a centerline radius of ${ft(Rgiven, 0)}. Lanes are 12 ft wide.`
      : `A horizontal curve has a radius of ${ft(R, 0)} to the centerline of the inside lane.`;
    const solution = [];
    if (road) solution.push(`R to the inside lane centerline = ${num(Rgiven, 0)} − 12/2 = ${num(R, 0)} ft`);
    solution.push(
      `Angle: 28.65 S / R = 28.65 × ${S} / ${num(R, 0)} = ${num(angle, 3)}° (degrees)`,
      `HSO = R(1 − cos(28.65 S / R)) = ${num(R, 0)} × (1 − cos(${num(angle, 3)}°)) = ${ft(hso)}`,
      `Check: L = ${num(L, 0)} ft is longer than S = ${S} ft, so the formula applies.`,
    );
    return {
      prompt: `${given}\nThe curve is ${ft(L, 0)} long.\nUse a stopping sight distance of ${S} ft.\nHow far from the centerline of the inside lane must a sight obstruction be, at least?`,
      answer: hso,
      answerType: 'length',
      unit: 'ft',
      solution,
      figure: { type: 'sightline', R, S, HSO: hso, V, L, ask: 'HSO' },
      mistakes: [
        { value: hso - 6, why: 'Measured to the inside edge of the lane, not to its centerline.' },
        { value: R * (1 - Math.cos((57.3 * S) / R * (Math.PI / 180))), why: 'Used 57.3 in place of 28.65 (the full angle, not the half angle).' },
        { value: R * (1 - Math.cos((28.65 * S) / R)), why: 'Took the cosine in radians. The angle is in degrees.' },
        { value: hso + 6, why: 'Measured from the road centerline.' },
        { value: R * (1 - Math.sin(((28.65 * S) / R) * (Math.PI / 180))), why: 'Used sine in place of cosine.' },
      ],
    };
  },
};

const LANES = {
  1: 'A two-lane road is rotated about its centerline (1 lane rotated, n₁ = 1).',
  1.5: 'A three-lane road is rotated about its centerline (1.5 lanes rotated, n₁ = 1.5).',
  2: 'A four-lane undivided road is rotated about its centerline (2 lanes rotated, n₁ = 2).',
};

const H6 = {
  id: 'H6',
  title: 'Superelevation transition',
  topic: 'horizontal',
  stage: 1,
  kinds: ['full'],
  asks: { full: ['Lr', 'Lt'] },
  inputs(rng) {
    const V = rng.int(6, 14) * 5;
    return { V, ed: rng.int(4, 8), n1: rng.pick([1, 1, 1.5, 2]), w: 12, eNC: 2 };
  },
  build({ V, ed, n1, w, eNC }, ask) {
    const rel = REL_GRADIENT[V];
    const bw = BW[n1];
    const Lr = F.runoffLength(w, n1, ed, rel, bw);
    const Lt = F.runoutLength(eNC, ed, Lr);
    const given = [
      LANES[n1],
      `Design speed: ${V} mph`,
      `Lane width w: ${w} ft`,
      `Design superelevation e_d: ${ed}%`,
      `Normal cross slope e_NC: ${eNC}%`,
      `Maximum relative gradient Δ: ${rel.toFixed(2)}%`,
      `Adjustment factor b_w: ${bw.toFixed(2)}`,
    ].join('\n');
    const stepLr = `L_r = (w n₁ e_d / Δ) b_w = (${w} × ${n1} × ${ed} / ${rel.toFixed(2)}) × ${bw.toFixed(2)} = ${ft(Lr, 1)}`;
    const figure = { type: 'runoff', V, e: ed, w, n1, Lr, Lt, ask };
    if (ask === 'Lr') {
      return {
        prompt: `${given}\nWhat is the superelevation runoff length L_r?`,
        answer: Lr,
        answerType: 'length',
        unit: 'ft',
        solution: [stepLr],
        figure,
        mistakes: [
          { value: (w * 2 * n1 * ed) / rel * bw, why: 'Counted all lanes, not the lanes rotated.' },
          { value: (w * n1 * (ed / 100)) / rel * bw, why: 'Used e_d as a decimal with Δ in percent.' },
          { value: (w * n1 * ed) / (rel / 100) * bw, why: 'Used Δ as a decimal with e_d in percent.' },
          { value: (w * n1 * ed) / rel, why: 'Left out b_w.' },
          { value: (w * n1 * ed) / rel / bw, why: 'Divided by b_w in place of multiplying.' },
        ],
      };
    }
    return {
      prompt: `${given}\nWhat is the tangent runout length L_t?`,
      answer: Lt,
      answerType: 'length',
      unit: 'ft',
      solution: [stepLr, `L_t = (e_NC / e_d) L_r = (${eNC} / ${ed}) × ${num(Lr, 1)} = ${ft(Lt, 1)}`],
      figure,
      mistakes: [
        { value: (ed / eNC) * Lr, why: 'Inverted the ratio. L_t = (e_NC / e_d) L_r.' },
        { value: Lr, why: 'That is the runoff L_r. The runout is a separate, shorter length.' },
        { value: (eNC / ed) * ((w * 2 * n1 * ed) / rel) * bw, why: 'Counted all lanes, not the lanes rotated, in L_r.' },
        { value: (eNC / ed) * ((w * n1 * ed) / (rel / 100)) * bw, why: 'Used Δ as a decimal with e_d in percent.' },
        { value: (eNC / 100) * Lr, why: 'Used e_NC alone in place of the ratio e_NC / e_d.' },
      ],
    };
  },
};

const V1 = {
  id: 'V1',
  title: 'Stopping sight distance',
  topic: 'vertical',
  stage: 1,
  kinds: ['full', 'step'],
  asks: { full: ['calculated', 'design', 'grade'], step: ['reaction', 'braking'] },
  inputs(rng, { stage }) {
    const V = rng.int(5, 16) * 5;
    const G = (rng.pick([-1, 1]) * rng.int(2, 9)) / 100;
    return { V, G, stage };
  },
  build({ V, G }, ask) {
    const reaction = 1.47 * V * 2.5;
    const braking = (1.075 * V ** 2) / 11.2;
    const values = 'Use the AASHTO design values for brake reaction time and deceleration.';
    const reactionStep = `Reaction distance = 1.47 V t = 1.47 × ${V} × 2.5 = ${ft(reaction, 1)}`;
    const brakingStep = `Braking distance = 1.075 V² / a = 1.075 × ${V}² / 11.2 = ${ft(braking, 1)}`;
    if (ask === 'reaction') {
      return {
        prompt: `Design speed: ${V} mph\n${values}\nWhat is the brake reaction distance?`,
        answer: reaction,
        answerType: 'length',
        unit: 'ft',
        solution: ['AASHTO: t = 2.5 s.', reactionStep],
        figure: { type: 'ssd', V, G: 0, S: reaction + braking, ask },
        mistakes: [
          { value: V * 2.5, why: 'Did not convert mph to ft/s (× 1.47).' },
          { value: 1.47 * V, why: 'Left out the reaction time t.' },
          { value: 1.47 * V * 1.0, why: 'Used t = 1.0 s. AASHTO uses 2.5 s.' },
          { value: 1.47 * V * 1.5, why: 'Used t = 1.5 s. AASHTO uses 2.5 s.' },
        ],
      };
    }
    if (ask === 'braking') {
      return {
        prompt: `Design speed: ${V} mph, level road\n${values}\nWhat is the braking distance?`,
        answer: braking,
        answerType: 'length',
        unit: 'ft',
        solution: ['AASHTO: a = 11.2 ft/s².', brakingStep],
        figure: { type: 'ssd', V, G: 0, S: reaction + braking, ask },
        mistakes: [
          { value: (1.075 * V) / 11.2, why: 'Did not square V.' },
          { value: (1.075 * V ** 2) / 32.2, why: 'Used g = 32.2 ft/s² as the deceleration.' },
          { value: V ** 2 / (2 * 11.2), why: 'Used V² / (2a) without converting mph to ft/s.' },
          { value: V ** 2 / (30 * 11.2), why: 'Used a in place of a / 32.2 in the form V² / (30 (a/32.2)).' },
        ],
      };
    }
    if (ask === 'grade') {
      const S = F.ssdGrade(V, G);
      const brake = V ** 2 / (30 * (11.2 / 32.2 + G));
      const word = G > 0 ? `${num(G * 100, 0)}% upgrade` : `${num(-G * 100, 0)}% downgrade`;
      return {
        prompt: `Design speed: ${V} mph\nGrade: ${word}\n${values}\nWhat is the stopping sight distance (calculated, not rounded)?`,
        answer: S,
        answerType: 'length',
        unit: 'ft',
        solution: [
          `G = ${dec(G, 2)} (uphill +, downhill −)`,
          reactionStep,
          `Braking distance = V² / (30 (a/32.2 + G)) = ${V}² / (30 × (${(11.2 / 32.2).toFixed(4)} ${G >= 0 ? '+' : '−'} ${Math.abs(G).toFixed(2)})) = ${ft(brake, 1)}`,
          `SSD = ${num(reaction, 1)} + ${num(brake, 1)} = ${ft(S, 1)}`,
        ],
        figure: { type: 'ssd', V, G, S, ask },
        mistakes: [
          { value: reaction + V ** 2 / (30 * (11.2 / 32.2 - G)), why: 'Used the wrong sign for the grade (uphill is +).' },
          { value: brake, why: 'Left out the reaction distance.' },
          { value: 1.47 * V * 1.0 + brake, why: 'Used t = 1.0 s. AASHTO uses 2.5 s.' },
          { value: reaction + V ** 2 / (30 * (11.2 / 32.2 + G * 100)), why: 'Used G in percent in place of a decimal.' },
          { value: reaction + braking, why: 'Left out the grade (used the level-road formula).' },
        ],
      };
    }
    const calc = reaction + braking;
    const design = F.designSSD(calc);
    const isDesign = ask === 'design';
    const solution = ['AASHTO: t = 2.5 s, a = 11.2 ft/s².', reactionStep, brakingStep, `Calculated SSD = ${num(reaction, 1)} + ${num(braking, 1)} = ${ft(calc, 1)}`];
    if (isDesign) solution.push(`Design SSD: round up to the next 5 ft = ${design} ft`);
    return {
      prompt: `Design speed: ${V} mph, level road\n${values}\nWhat is the ${isDesign ? 'design' : 'calculated'} stopping sight distance?`,
      answer: isDesign ? design : calc,
      answerType: 'length',
      unit: 'ft',
      solution,
      figure: { type: 'ssd', V, G: 0, S: isDesign ? design : calc, ask },
      mistakes: [
        { value: braking, why: 'Left out the reaction distance.' },
        { value: 1.47 * V * 1.0 + braking, why: 'Used t = 1.0 s. AASHTO uses 2.5 s.' },
        { value: V * 2.5 + braking, why: 'Did not convert mph to ft/s in the reaction distance.' },
        { value: reaction + (1.075 * V ** 2) / 32.2, why: 'Used g = 32.2 ft/s² as the deceleration.' },
        { value: reaction + (1.075 * V) / 11.2, why: 'Did not square V.' },
      ],
    };
  },
};

function vcurveInputs(rng, curve) {
  // Grades in steps of 0.5%. A crest goes up then down; a sag goes down then up.
  const up = rng.int(2, 12) / 200;
  const down = -rng.int(2, 12) / 200;
  const [g1, g2] = curve === 'crest' ? [up, down] : [down, up];
  return {
    curve,
    g1,
    g2,
    A: Math.abs(g2 - g1) * 100,
    pviStation: rng.int(20, 120) * 100 + rng.int(0, 19) * 5,
    pviElevation: roundTo(100 + rng() * 800, 0.01),
  };
}

function gradesText(g1, g2) {
  return `g₁ = ${pct(g1)} and g₂ = ${pct(g2)}`;
}

/** The step mode of V2 and V3: K, L from K, or the 3V minimum. */
function vcurveStep(inp, ask, curveWord, constantText) {
  const { g1, g2, A, V, K, Lgiven } = inp;
  const figure = { type: 'vcurve', curve: inp.curve, g1, g2, L: null, S: null, pviStation: inp.pviStation, pviElevation: inp.pviElevation, ask };
  if (ask === 'K') {
    return {
      prompt: `A ${curveWord} vertical curve joins ${gradesText(g1, g2)}.\nIts length is ${ft(Lgiven, 0)}.\nWhat is its K value?`,
      answer: Lgiven / A,
      answerType: 'length',
      unit: 'ft/%',
      solution: [`A = |g₂ − g₁| = ${num(A, 1)}%`, `K = L / A = ${num(Lgiven, 0)} / ${num(A, 1)} = ${num(Lgiven / A, 1)} ft/%`],
      figure: { ...figure, L: Lgiven },
      mistakes: [
        { value: Lgiven * A, why: 'Multiplied L by A.' },
        { value: Lgiven / (A / 100), why: 'Used A as a decimal. K uses A in percent.' },
        { value: Lgiven / (Math.abs(g1) * 100), why: 'Used one grade, not the algebraic difference A.' },
        { value: Lgiven / 2 / A, why: 'Used L/2.' },
      ],
    };
  }
  if (ask === 'LfromK') {
    return {
      prompt: `A ${curveWord} vertical curve joins ${gradesText(g1, g2)}.\nUse a design K of ${K} ${constantText}.\nWhat is the minimum curve length?`,
      answer: K * A,
      answerType: 'length',
      unit: 'ft',
      solution: [`A = |g₂ − g₁| = ${num(A, 1)}%`, `L = K × A = ${K} × ${num(A, 1)} = ${ft(K * A, 1)}`],
      figure: { ...figure, L: K * A },
      mistakes: [
        { value: K / A, why: 'Divided K by A.' },
        { value: (K * A) / 100, why: 'Used A as a decimal.' },
        { value: K * Math.abs(g1) * 100, why: 'Used one grade, not the algebraic difference A.' },
        { value: (K * Math.abs(g1 + g2)) * 100, why: 'Added the grades with their signs. A = |g₂ − g₁|.' },
      ],
    };
  }
  return {
    prompt: `A ${curveWord} vertical curve is on a road with a design speed of ${V} mph.\nWhat is the GDHS minimum length of any vertical curve at this speed?`,
    answer: F.minCurveLength(V),
    answerType: 'length',
    unit: 'ft',
    solution: ['GDHS: the minimum length of a vertical curve is 3V (L in ft, V in mph).', `L_min = 3 × ${V} = ${3 * V} ft`],
    figure,
    mistakes: [
      { value: V, why: 'Used V. The rule is 3V.' },
      { value: 1.47 * V, why: 'Used the speed in ft/s. The rule is 3V with V in mph.' },
      { value: 10 * V, why: 'Used 10V. The rule is 3V.' },
      { value: 2 * V, why: 'Used 2V. The rule is 3V.' },
    ],
  };
}

const V2 = {
  id: 'V2',
  title: 'Crest curve length',
  topic: 'vertical',
  stage: 2,
  kinds: ['full', 'step'],
  asks: { full: ['ssd', 'ssd', 'psd'], step: ['K', 'LfromK', 'Lmin'] },
  inputs(rng) {
    const V = rng.int(6, 14) * 5;
    const base = vcurveInputs(rng, 'crest');
    const S = F.designSSD(F.ssdLevel(V));
    return { ...base, V, S, P: PSD[V], K: CREST_K[V], Lgiven: rng.int(4, 16) * 50 };
  },
  build(inp, ask) {
    if (ask === 'K' || ask === 'LfromK' || ask === 'Lmin') return vcurveStep(inp, ask, 'crest', 'for stopping sight distance');
    const { g1, g2, A, V } = inp;
    const passing = ask === 'psd';
    const S = passing ? inp.P : inp.S;
    const C = passing ? 2800 : 2158;
    const other = passing ? 2158 : 2800;
    const r = F.crestLength(S, A, C);
    if (r.L < F.minCurveLength(V)) return null;
    const long = (A * S ** 2) / C;
    const short = 2 * S - C / A;
    const word = passing ? 'passing' : 'stopping';
    const solution = [`A = |g₂ − g₁| = ${num(A, 1)}%`, `Try S < L: L = A S² / ${C} = ${num(A, 1)} × ${S}² / ${C} = ${ft(long, 1)}`];
    if (r.case === 'S<L') solution.push(`L = ${num(long, 1)} ft is longer than S = ${S} ft, so S < L holds. L = ${ft(r.L, 1)}`);
    else solution.push(`L = ${num(long, 1)} ft is shorter than S = ${S} ft, so use S > L.`, `L = 2S − ${C} / A = 2 × ${S} − ${C} / ${num(A, 1)} = ${ft(r.L, 1)}`);
    return {
      prompt: `A crest vertical curve joins ${gradesText(g1, g2)}.\nDesign speed: ${V} mph. Use a ${word} sight distance of ${S} ft.\nWhat is the minimum curve length for ${word} sight distance?`,
      answer: r.L,
      answerType: 'length',
      unit: 'ft',
      solution,
      figure: { type: 'vcurve', curve: 'crest', g1, g2, L: r.L, S, pviStation: inp.pviStation, pviElevation: inp.pviElevation, ask },
      mistakes: [
        { value: r.case === 'S<L' ? short : long, why: `Used the ${r.case === 'S<L' ? 'S > L' : 'S < L'} case. Check which case agrees with the result.` },
        { value: F.crestLength(S, A / 100, C).L, why: 'Used A as a decimal. The formula takes A in percent.' },
        { value: F.crestLength(S, A, other).L, why: `Used ${other} in place of ${C} (the ${passing ? 'stopping' : 'passing'} constant).` },
        { value: F.sagLength(S, A).L, why: 'Used the sag curve (headlight) formula.' },
      ],
    };
  },
};

const V3 = {
  id: 'V3',
  title: 'Sag curve length',
  topic: 'vertical',
  stage: 2,
  kinds: ['full', 'step'],
  asks: { full: ['headlight', 'headlight', 'headlight', 'comfort'], step: ['K', 'LfromK', 'Lmin'] },
  inputs(rng) {
    const V = rng.int(6, 14) * 5;
    const base = vcurveInputs(rng, 'sag');
    const S = F.designSSD(F.ssdLevel(V));
    return { ...base, V, S, K: SAG_K[V], Lgiven: rng.int(4, 16) * 50 };
  },
  build(inp, ask) {
    if (ask === 'K' || ask === 'LfromK' || ask === 'Lmin') return vcurveStep(inp, ask, 'sag', 'for headlight sight distance');
    const { g1, g2, A, V, S } = inp;
    const figure = { type: 'vcurve', curve: 'sag', g1, g2, L: null, S, pviStation: inp.pviStation, pviElevation: inp.pviElevation, ask };
    if (ask === 'comfort') {
      const L = F.sagComfortLength(A, V);
      if (L < F.minCurveLength(V)) return null;
      return {
        prompt: `A sag vertical curve on a lit road joins ${gradesText(g1, g2)}.\nDesign speed: ${V} mph.\nUse the comfort criterion. What is the minimum curve length?`,
        answer: L,
        answerType: 'length',
        unit: 'ft',
        solution: [`A = |g₂ − g₁| = ${num(A, 1)}%`, `L = A V² / 46.5 = ${num(A, 1)} × ${V}² / 46.5 = ${ft(L, 1)}`],
        figure: { ...figure, L },
        mistakes: [
          { value: F.sagLength(S, A).L, why: 'Used the headlight criterion, not the comfort criterion.' },
          { value: (A * V) / 46.5, why: 'Did not square V.' },
          { value: ((A / 100) * V ** 2) / 46.5, why: 'Used A as a decimal.' },
          { value: (A * (1.47 * V) ** 2) / 46.5, why: 'Converted V to ft/s. The formula takes mph.' },
        ],
      };
    }
    const r = F.sagLength(S, A);
    if (r.L < F.minCurveLength(V)) return null;
    const den = 400 + 3.5 * S;
    const long = (A * S ** 2) / den;
    const short = 2 * S - den / A;
    const solution = [`A = |g₂ − g₁| = ${num(A, 1)}%`, `Try S < L: L = A S² / (400 + 3.5S) = ${num(A, 1)} × ${S}² / ${num(den, 1)} = ${ft(long, 1)}`];
    if (r.case === 'S<L') solution.push(`L = ${num(long, 1)} ft is longer than S = ${S} ft, so S < L holds. L = ${ft(r.L, 1)}`);
    else solution.push(`L = ${num(long, 1)} ft is shorter than S = ${S} ft, so use S > L.`, `L = 2S − (400 + 3.5S) / A = 2 × ${S} − ${num(den, 1)} / ${num(A, 1)} = ${ft(r.L, 1)}`);
    return {
      prompt: `A sag vertical curve joins ${gradesText(g1, g2)}.\nDesign speed: ${V} mph. Use a stopping sight distance of ${S} ft.\nWhat is the minimum curve length by the headlight criterion?`,
      answer: r.L,
      answerType: 'length',
      unit: 'ft',
      solution,
      figure: { ...figure, L: r.L },
      mistakes: [
        { value: r.case === 'S<L' ? short : long, why: `Used the ${r.case === 'S<L' ? 'S > L' : 'S < L'} case. Check which case agrees with the result.` },
        { value: F.crestLength(S, A, 2158).L, why: 'Used the crest constant 2158. Sag curves use the headlight formula.' },
        { value: F.sagComfortLength(A, V), why: 'Used the comfort criterion, not the headlight criterion.' },
        { value: F.sagLength(S, A / 100).L, why: 'Used A as a decimal. The formula takes A in percent.' },
      ],
    };
  },
};

const V4 = {
  id: 'V4',
  title: 'Vertical curve geometry',
  topic: 'vertical',
  stage: 2,
  kinds: ['full', 'step'],
  asks: { full: ['elevAt', 'turnStation', 'turnElev'], step: ['PVC', 'PVT'] },
  inputs(rng) {
    const base = vcurveInputs(rng, rng.pick(['crest', 'sag']));
    const L = rng.int(4, 12) * 100;
    const x = rng.int(1, L / 50 - 1) * 50;
    return { ...base, L, x };
  },
  build(inp, ask) {
    const { g1, g2, L, pviStation, pviElevation, x, curve } = inp;
    const c = F.verticalCurve(pviStation, pviElevation, g1, g2, L);
    const figure = { type: 'vcurve', curve, g1, g2, L, S: null, pviStation, pviElevation, ask };
    const given = [
      'An equal-tangent vertical curve has these values:',
      `PVI station: ${sta(pviStation)}, elevation ${ft(pviElevation)}`,
      `Grades: ${gradesText(g1, g2)}`,
      `Curve length L: ${ft(L, 0)}`,
    ].join('\n');
    const units = 'Use g as a decimal with x and L in feet, or g in percent with x and L in stations.';
    const stepPVC = `PVC station = PVI − L/2 = ${sta(pviStation)} − ${num(L / 2, 0)} = ${sta(c.pvc)}`;
    const stepPVCElev = `PVC elevation = PVI elevation − g₁ L/2 = ${num(pviElevation, 2)} − (${dec(g1, 3)} × ${num(L / 2, 0)}) = ${ft(c.pvcElevation)}`;
    if (ask === 'PVC' || ask === 'PVT') {
      const isPVC = ask === 'PVC';
      const answer = isPVC ? c.pvc : c.pvt;
      return {
        prompt: `${given}\nWhat is the station of the ${ask}?`,
        answer,
        answerType: 'station',
        unit: '',
        solution: [isPVC ? stepPVC : `PVT station = PVI + L/2 = ${sta(pviStation)} + ${num(L / 2, 0)} = ${sta(c.pvt)}`],
        figure,
        mistakes: [
          { value: isPVC ? pviStation - L : pviStation + L, why: 'Used L, not L/2.' },
          { value: isPVC ? c.pvt : c.pvc, why: `That is the ${isPVC ? 'PVT' : 'PVC'}.` },
          { value: isPVC ? pviStation - L / 200 : pviStation + L / 200, why: 'Mixed stations and feet: used L/2 in stations as feet.' },
          { value: isPVC ? pviStation - L / 4 : pviStation + L / 4, why: 'Used L/4.' },
        ],
      };
    }
    if (ask === 'elevAt') {
      const station = c.pvc + x;
      const y = c.elevationAt(station);
      const tangent = c.pvcElevation + g1 * x;
      const offset = ((g2 - g1) * x ** 2) / (2 * L);
      return {
        prompt: `${given}\n${units}\nWhat is the elevation of the curve at station ${sta(station)}?`,
        answer: y,
        answerType: 'elevation',
        unit: 'ft',
        solution: [
          stepPVC,
          stepPVCElev,
          `x = ${sta(station)} − ${sta(c.pvc)} = ${num(x, 0)} ft`,
          `y = y_PVC + g₁x + (g₂ − g₁)x² / (2L) = ${num(c.pvcElevation, 2)} + (${dec(g1, 3)} × ${num(x, 0)}) + (${dec(g2 - g1, 3)} × ${num(x, 0)}² / (2 × ${num(L, 0)}))`,
          `y = ${num(c.pvcElevation, 2)} ${term(g1 * x)} ${term(offset)} = ${ft(y)}`,
        ],
        figure,
        mistakes: [
          { value: c.pvcElevation + g1 * 100 * x + ((g2 - g1) * 100 * x ** 2) / (2 * L), why: 'Used grades in percent with x in feet (100 times too large).' },
          { value: tangent - offset, why: 'Used the wrong sign for (g₂ − g₁).' },
          { value: tangent, why: 'Left out the curve term (the offset from the tangent).' },
          {
            value: pviElevation + g1 * (station - pviStation) + ((g2 - g1) * (station - pviStation) ** 2) / (2 * L),
            why: 'Measured x from the PVI, not from the PVC.',
          },
          {
            value: pviElevation - g1 * L + g1 * (station - (pviStation - L)) + ((g2 - g1) * (station - (pviStation - L)) ** 2) / (2 * L),
            why: 'Used PVC = PVI − L in place of PVI − L/2.',
          },
        ],
      };
    }
    const turn = c.turn;
    if (!turn) return null;
    const word = curve === 'crest' ? 'high' : 'low';
    const xStep = `x = −g₁ L / (g₂ − g₁) = −(${dec(g1, 3)}) × ${num(L, 0)} / (${dec(g2 - g1, 3)}) = ${num(turn.x, 2)} ft from the PVC`;
    if (ask === 'turnStation') {
      return {
        prompt: `${given}\nWhat is the station of the ${word} point of the curve?`,
        answer: turn.station,
        answerType: 'station',
        unit: '',
        solution: [stepPVC, xStep, `Station = ${sta(c.pvc)} + ${num(turn.x, 2)} = ${sta(turn.station)}`],
        figure,
        mistakes: [
          { value: c.pvc + (g1 * L) / (g1 + g2), why: 'Used x = g₁L / (g₁ + g₂).' },
          { value: pviStation + turn.x, why: 'Measured x from the PVI, not from the PVC.' },
          { value: c.pvc + (-g2 * L) / (g2 - g1), why: 'Used g₂ in place of g₁ in the numerator.' },
          { value: pviStation, why: `Assumed the ${word} point is at the PVI.` },
        ],
      };
    }
    return {
      prompt: `${given}\nWhat is the elevation of the ${word} point of the curve?`,
      answer: turn.elevation,
      answerType: 'elevation',
      unit: 'ft',
      solution: [
        stepPVCElev,
        xStep,
        `y = y_PVC + g₁x + (g₂ − g₁)x² / (2L) = ${ft(turn.elevation)}`,
      ],
      figure,
      mistakes: [
        { value: pviElevation, why: 'Used the PVI elevation. The curve does not pass through the PVI.' },
        { value: c.pvcElevation + g1 * turn.x - ((g2 - g1) * turn.x ** 2) / (2 * L), why: 'Used the wrong sign for (g₂ − g₁).' },
        { value: c.pvcElevation + g1 * turn.x, why: 'Left out the curve term (the offset from the tangent).' },
        { value: c.pvcElevation + g1 * 100 * turn.x + ((g2 - g1) * 100 * turn.x ** 2) / (2 * L), why: 'Used grades in percent with x in feet (100 times too large).' },
      ],
    };
  },
};

const ALL = [H1, H2, H3, H4, H5, H6, V1, V2, V3, V4];
const BY_ID = Object.fromEntries(ALL.map((g) => [g.id, g]));

export const GENERATORS = ALL.map(({ id, title, topic, stage, kinds }) => ({ id, title, topic, stage, kinds }));

const FIELD_BOOK_OF = { H1: 'degree', H2: 'curve', H3: 'curve', H4: 'friction', H5: 'sightline', H6: 'runoff', V1: 'ssd', V2: 'crest', V3: 'sag', V4: 'vcurve' };

let serial = 0;

/** Build one question from fixed inputs. null if the inputs give too few wrong options. */
function assemble(gen, rng, kind, inputs, ask) {
  const body = gen.build(inputs, ask);
  if (!body) return null;
  const { mistakes, ...rest } = body;
  const q = {
    id: `${gen.id}-${ask}-${++serial}`,
    gen: gen.id,
    topic: gen.topic,
    kind,
    title: gen.title,
    numeric: true,
    fieldBook: FIELD_BOOK_OF[gen.id],
    figure: null,
    ...rest,
  };
  q.choices = numericChoices(rng, q, mistakes);
  return q.choices ? q : null;
}

const MAX_TRIES = 60;

export function makeQuestion(id, rng, { kind, stage = 2, ask } = {}) {
  const gen = BY_ID[id];
  if (!gen) throw new Error(`Unknown generator "${id}".`);
  const k = kind ?? gen.kinds[0];
  if (!gen.kinds.includes(k)) throw new Error(`Generator ${id} has no "${k}" kind.`);
  let asks = gen.asks[k];
  // V1 on a grade is stage 2 only.
  if (id === 'V1' && stage < 2) asks = asks.filter((a) => a !== 'grade');
  for (let i = 0; i < MAX_TRIES; i++) {
    const q = assemble(gen, rng, k, gen.inputs(rng, { stage }), ask ?? rng.pick(asks));
    if (q) return q;
  }
  throw new Error(`Generator ${id} found no valid inputs.`);
}

// ---------- Elites: linked parts with the same inputs ----------

const ELITES = {
  1: [
    {
      title: 'Curve layout',
      make(rng) {
        for (let i = 0; i < MAX_TRIES; i++) {
          const inp = curveInputs(rng);
          const parts = [assemble(H2, rng, 'full', inp, 'PC'), assemble(H2, rng, 'full', inp, 'PT'), assemble(H3, rng, 'step', inp, 'M')];
          if (parts.every(Boolean)) return parts;
        }
        return null;
      },
    },
    {
      title: 'Sight around a bend',
      make(rng) {
        for (let i = 0; i < MAX_TRIES; i++) {
          const s = H5.inputs(rng);
          const first = assemble(V1, rng, 'full', { V: s.V, G: 0 }, 'design');
          const second = assemble(H5, rng, 'full', s, rng.pick(['lane', 'road']));
          if (first && second) return [first, second];
        }
        return null;
      },
    },
  ],
  2: [
    {
      title: 'Crest design',
      make(rng) {
        for (let i = 0; i < MAX_TRIES; i++) {
          const inp = V2.inputs(rng);
          const first = assemble(V2, rng, 'full', inp, 'ssd');
          if (!first) continue;
          const L = Math.ceil(first.answer / 50) * 50;
          const geo = { ...inp, L, x: Math.round(L / 100) * 50 };
          const parts = [first, assemble(V4, rng, 'full', geo, 'turnStation'), assemble(V4, rng, 'full', geo, 'elevAt')];
          if (parts.every(Boolean)) {
            parts[1].prompt = `The designer rounds the curve up to L = ${num(L, 0)} ft.\n${parts[1].prompt}`;
            parts[2].prompt = `The designer rounds the curve up to L = ${num(L, 0)} ft.\n${parts[2].prompt}`;
            return parts;
          }
        }
        return null;
      },
    },
    {
      title: 'Sag design',
      make(rng) {
        for (let i = 0; i < MAX_TRIES; i++) {
          const inp = V3.inputs(rng);
          const first = assemble(V3, rng, 'full', inp, 'headlight');
          if (!first) continue;
          const L = Math.ceil(first.answer / 50) * 50;
          const geo = { ...inp, L, x: 0 };
          const parts = [first, assemble(V4, rng, 'full', geo, 'turnStation'), assemble(V4, rng, 'full', geo, 'turnElev')];
          if (parts.every(Boolean)) {
            parts[1].prompt = `The designer rounds the curve up to L = ${num(L, 0)} ft.\n${parts[1].prompt}`;
            parts[2].prompt = `The designer rounds the curve up to L = ${num(L, 0)} ft.\n${parts[2].prompt}`;
            return parts;
          }
        }
        return null;
      },
    },
  ],
};

export function makeElite(rng, { stage }) {
  const pool = stage >= 2 ? [...ELITES[1], ...ELITES[2]] : ELITES[1];
  const elite = rng.pick(pool);
  const questions = elite.make(rng);
  if (!questions) throw new Error(`Elite "${elite.title}" found no valid inputs.`);
  return { title: elite.title, questions };
}

// ---------- Concept questions ----------

const CONCEPTS = [
  // Horizontal
  { topic: 'horizontal', fb: 'degree', q: 'Under the arc definition, the degree of curve D is the central angle of:', a: 'A 100 ft arc', w: [['A 100 ft chord', 'That is the chord definition.'], ['A 100 m arc', 'The US definition uses 100 ft.'], ['One full station of tangent', 'D is measured on the curve, not on the tangent.']] },
  { topic: 'horizontal', fb: 'degree', q: 'Which definition of degree of curve do railroads mostly use?', a: 'The chord definition', w: [['The arc definition', 'Highways mostly use the arc definition.'], ['The tangent definition', 'There is no tangent definition of D.'], ['The external definition', 'There is no external definition of D.']] },
  { topic: 'horizontal', fb: 'curve', q: 'The middle ordinate M is the distance from:', a: 'The midpoint of the curve to the midpoint of the long chord', w: [['The PI to the midpoint of the curve', 'That is the external distance E.'], ['The PI to the PC', 'That is the tangent length T.'], ['The PC to the PT along the curve', 'That is the curve length L.']] },
  { topic: 'horizontal', fb: 'curve', q: 'The external distance E is the distance from:', a: 'The PI to the midpoint of the curve', w: [['The midpoint of the curve to the midpoint of the long chord', 'That is the middle ordinate M.'], ['The PC to the PT in a straight line', 'That is the long chord LC.'], ['The PI to the PT', 'That is the tangent length T.']] },
  { topic: 'horizontal', fb: 'curve', q: 'Stations on a curve run along:', a: 'The curve, so PT = PC + L', w: [['The tangents, so PT = PI + T', 'A common mistake. Stations follow the alignment, which is the curve.'], ['The long chord, so PT = PC + LC', 'The alignment follows the arc, not the chord.'], ['The radius, so PT = PC + R', 'R is not a distance along the road.']] },
  { topic: 'horizontal', fb: 'sightline', q: 'In the horizontal sightline offset formula, R is the radius to:', a: 'The centerline of the inside lane', w: [['The road centerline', 'The driver is in the inside lane, so R goes to that lane centerline.'], ['The inside edge of the pavement', 'R goes to the lane centerline.'], ['The centerline of the outside lane', 'The critical driver is in the inside lane.']] },
  { topic: 'horizontal', fb: 'sightline', q: 'The formula HSO = R[1 − cos(28.65 S / R)] applies when:', a: 'The sight distance S is shorter than the curve length L', w: [['S is longer than L', 'Then the driver or the object is on a tangent, and the formula does not apply.'], ['The curve has no superelevation', 'Superelevation does not change this geometry.'], ['The radius is above 1,000 ft', 'The formula has no radius limit.']] },
  { topic: 'horizontal', fb: 'friction', q: 'In 0.01e + f = V² / (15R), f is:', a: 'The side friction factor', w: [['The grade in percent', 'Grade is G, and it is not in this formula.'], ['The deceleration rate', 'Deceleration is a, used in stopping sight distance.'], ['The degree of curve', 'Degree of curve is D.']] },
  { topic: 'horizontal', fb: 'friction', q: 'As the design speed goes up, the AASHTO maximum side friction factor f_max:', a: 'Goes down', w: [['Goes up', 'Drivers accept less side friction at high speed.'], ['Stays the same', 'f_max changes with speed.'], ['Depends only on e_max', 'f_max depends on the design speed.']] },
  { topic: 'horizontal', fb: 'runoff', q: 'The superelevation runoff is the length over which:', a: 'The outside lane goes from level to the full superelevation', w: [['The outside lane goes from the normal crown to level', 'That is the tangent runout.'], ['The road goes from the tangent to the curve', 'That is the PC, a point, not a length.'], ['A car slows to the curve speed', 'Runoff is about the cross slope, not speed.']] },
  { topic: 'horizontal', fb: 'runoff', q: 'The tangent runout is the length over which:', a: 'The outside lane goes from the normal crown to level', w: [['The outside lane goes from level to the full superelevation', 'That is the runoff.'], ['The inside lane goes to the full superelevation', 'The inside lane already slopes the right way.'], ['The curve widens', 'That is curve widening.']] },
  { topic: 'horizontal', fb: 'runoff', q: 'In the runoff formula L_r = (w n₁ e_d / Δ) b_w, the factor b_w:', a: 'Adjusts for the number of lanes rotated', w: [['Adjusts for the lane width', 'The lane width is w.'], ['Is the maximum relative gradient', 'That is Δ.'], ['Adjusts for the grade of the road', 'The formula has no grade term.']] },
  // Vertical
  { topic: 'vertical', fb: 'ssd', q: 'The AASHTO brake reaction time for stopping sight distance is:', a: '2.5 s', w: [['1.0 s', 'AASHTO uses 2.5 s, which covers most drivers.'], ['1.5 s', 'AASHTO uses 2.5 s.'], ['2.0 s', 'AASHTO uses 2.5 s.']] },
  { topic: 'vertical', fb: 'ssd', q: 'The AASHTO deceleration rate for stopping sight distance is:', a: '11.2 ft/s²', w: [['32.2 ft/s²', 'That is the acceleration of gravity.'], ['14.8 ft/s²', 'AASHTO uses 11.2 ft/s².'], ['9.8 ft/s²', 'That is gravity in m/s².']] },
  { topic: 'vertical', fb: 'ssd', q: 'On a downgrade, the braking distance is:', a: 'Longer than on a level road', w: [['Shorter than on a level road', 'Gravity pulls the car forward on a downgrade.'], ['The same as on a level road', 'The grade term changes the braking distance.'], ['Longer only above 50 mph', 'The grade affects all speeds.']] },
  { topic: 'vertical', fb: 'crest', q: 'For sight distance design, AASHTO uses a driver eye height of:', a: '3.5 ft', w: [['2.0 ft', 'That is the object height for stopping sight distance.'], ['3.75 ft', 'An older value. GDHS uses 3.5 ft.'], ['4.5 ft', 'AASHTO uses 3.5 ft.']] },
  { topic: 'vertical', fb: 'crest', q: 'For stopping sight distance, AASHTO uses an object height of:', a: '2.0 ft', w: [['0.5 ft', 'An older value. GDHS uses 2.0 ft.'], ['3.5 ft', 'That is the object height for passing sight distance.'], ['1.0 ft', 'GDHS uses 2.0 ft.']] },
  { topic: 'vertical', fb: 'crest', q: 'For passing sight distance on a crest curve, AASHTO uses an object height of:', a: '3.5 ft', w: [['2.0 ft', 'That is for stopping sight distance.'], ['0.5 ft', 'An older stopping value.'], ['4.25 ft', 'GDHS uses 3.5 ft.']] },
  { topic: 'vertical', fb: 'crest', q: 'The crest constant 2158 comes from:', a: 'An eye height of 3.5 ft and an object height of 2.0 ft', w: [['An eye height and an object height of 3.5 ft', 'That gives 2800, the passing constant.'], ['A headlight height of 2.0 ft and a 1° beam', 'That is the sag headlight criterion.'], ['An eye height of 3.75 ft and an object height of 0.5 ft', 'Those are older values.']] },
  { topic: 'vertical', fb: 'crest', q: 'You use the S < L crest formula and get an L shorter than S. What next?', a: 'Use the S > L formula', w: [['Use the result', 'The result does not agree with its own case.'], ['Double the result', 'There is no such rule.'], ['Use the sag formula', 'The curve is still a crest.']] },
  { topic: 'vertical', fb: 'sag', q: 'On a road without lights, AASHTO bases the minimum sag curve length mostly on:', a: 'Headlight sight distance', w: [['Driver comfort', 'Comfort applies mostly where the road has lights.'], ['Drainage', 'Drainage is a check, not the main criterion.'], ['Passing sight distance', 'Passing sight distance applies to crest curves.']] },
  { topic: 'vertical', fb: 'sag', q: 'The AASHTO headlight criterion for sag curves assumes:', a: 'A headlight height of 2.0 ft and a 1° upward divergence of the beam', w: [['A headlight height of 3.5 ft and a 1° upward divergence', '3.5 ft is the driver eye height.'], ['A headlight height of 2.0 ft and a 2° upward divergence', 'AASHTO uses 1°.'], ['A headlight height of 2.5 ft and no divergence', 'AASHTO uses 2.0 ft and 1°.']] },
  { topic: 'vertical', fb: 'vcurve', q: 'K for a vertical curve is:', a: 'The horizontal length for a 1% change in grade (L / A)', w: [['A × L', 'K = L / A.'], ['The change in grade per foot (A / L)', 'That is the rate of change of grade, the inverse of K.'], ['The elevation change between the PVC and the PVT', 'K is a length per percent of grade change.']] },
  { topic: 'vertical', fb: 'vcurve', q: 'On an equal-tangent vertical curve, the PVI is:', a: 'Halfway between the PVC and the PVT in horizontal distance', w: [['On the curve at its high or low point', 'The PVI is where the tangents meet, off the curve.'], ['At the PVC', 'The PVC is L/2 before the PVI.'], ['Closer to the steeper grade', 'Equal tangents put it at the middle.']] },
  { topic: 'vertical', fb: 'vcurve', q: 'The GDHS minimum length of a vertical curve, for a design speed V in mph, is:', a: '3V ft', w: [['V ft', 'The rule is 3V.'], ['1.47V ft', 'That is the speed in ft/s.'], ['10V ft', 'The rule is 3V.']] },
];

export function makeConcept(rng, { topic } = {}) {
  const pool = topic ? CONCEPTS.filter((c) => c.topic === topic) : CONCEPTS;
  const c = rng.pick(pool);
  const options = [{ text: c.a, value: null, correct: true, why: '' }, ...c.w.map(([text, why]) => ({ text, value: null, correct: false, why }))];
  return {
    id: `C-${++serial}`,
    gen: 'C',
    topic: c.topic,
    kind: 'quick',
    title: 'Concept',
    prompt: c.q,
    answer: null,
    answerType: null,
    unit: '',
    numeric: false,
    choices: rng.shuffle(options),
    solution: [c.a + '.'],
    fieldBook: c.fb,
    figure: null,
  };
}

/** For tests: the count of concept questions for each topic. */
export const CONCEPT_COUNT = { horizontal: CONCEPTS.filter((c) => c.topic === 'horizontal').length, vertical: CONCEPTS.filter((c) => c.topic === 'vertical').length };
