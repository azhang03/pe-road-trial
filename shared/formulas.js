// The design formulas for the question generators. No DOM.
// Content and sources: ../CONTENT.md. The tests in questions.test.mjs check these.
// All functions use US customary units. `units` selects the constants. Only 'us' exists now.

export const UNITS = {
  us: {
    mphToFtS: 1.47, // ft/s for each mph
    reactionTime: 2.5, // s, AASHTO brake reaction time
    decel: 11.2, // ft/s², AASHTO deceleration rate
    gravity: 32.2, // ft/s²
    brakeLevel: 1.075, // braking term on a level road: 1.075 V² / a
    gradeK: 30, // braking term on a grade: V² / (30 (a/g ± G))
    frictionK: 15, // 0.01e + f = V² / (15 R)
    crestSSD: 2158, // 200 (√h1 + √h2)², h1 = 3.5 ft, h2 = 2.0 ft
    crestPSD: 2800, // 200 (√h1 + √h2)², h1 = h2 = 3.5 ft
    sagBase: 400, // headlight: 200 (H + S tan 1°), H = 2.0 ft
    sagPerS: 3.5,
    comfort: 46.5,
    minLengthPerMph: 3, // GDHS minimum vertical curve length: 3V ft
  },
};

export function constants(units = 'us') {
  const c = UNITS[units];
  if (!c) throw new Error(`Unknown units "${units}".`);
  return c;
}

const RAD = Math.PI / 180;

// ---------- Horizontal curves ----------

/** Radius from the degree of curve, arc definition (D in degrees for a 100 ft arc). */
export function radiusFromDegree(D) {
  return 18000 / (Math.PI * D);
}

/** Degree of curve from the radius, arc definition. */
export function degreeFromRadius(R) {
  return 18000 / (Math.PI * R);
}

/** Radius from the degree of curve, chord definition (D for a 100 ft chord). */
export function radiusFromDegreeChord(D) {
  return 50 / Math.sin((D / 2) * RAD);
}

/** The elements of a circular curve. delta in degrees. */
export function curveElements(R, delta) {
  const half = (delta / 2) * RAD;
  return {
    T: R * Math.tan(half),
    L: (Math.PI * R * delta) / 180,
    LC: 2 * R * Math.sin(half),
    M: R * (1 - Math.cos(half)),
    E: R * (1 / Math.cos(half) - 1),
  };
}

/** PC and PT stations (in feet) from the PI station. */
export function curveStations(pi, R, delta) {
  const { T, L } = curveElements(R, delta);
  const pc = pi - T;
  return { pc, pt: pc + L };
}

/** Minimum radius for a speed. e in percent, f as a decimal. */
export function minRadius(V, e, f, units = 'us') {
  return V ** 2 / (constants(units).frictionK * (0.01 * e + f));
}

/** Side friction demand for a speed and a radius. e in percent. */
export function frictionDemand(V, R, e, units = 'us') {
  return V ** 2 / (constants(units).frictionK * R) - 0.01 * e;
}

/** The highest speed for a radius. e in percent, f as a decimal. */
export function maxSpeed(R, e, f, units = 'us') {
  return Math.sqrt(constants(units).frictionK * R * (0.01 * e + f));
}

/**
 * Horizontal sightline offset. R is the radius to the centerline of the inside lane.
 * Valid only when the curve is longer than S (GDHS Eq. 3-37 as quoted in [S3]).
 */
export function sightlineOffset(R, S) {
  return R * (1 - Math.cos(((28.65 * S) / R) * RAD));
}

/** Superelevation runoff length. e_d and the relative gradient in percent. */
export function runoffLength(w, n1, ed, relGradient, bw) {
  return ((w * n1 * ed) / relGradient) * bw;
}

/** Tangent runout length. Both slopes in percent. */
export function runoutLength(eNC, ed, Lr) {
  return (eNC / ed) * Lr;
}

// ---------- Sight distance ----------

/** Stopping sight distance on a level road, calculated (not rounded). */
export function ssdLevel(V, units = 'us') {
  const c = constants(units);
  return c.mphToFtS * V * c.reactionTime + (c.brakeLevel * V ** 2) / c.decel;
}

/** Stopping sight distance on a grade. G as a decimal, uphill positive. */
export function ssdGrade(V, G, units = 'us') {
  const c = constants(units);
  return c.mphToFtS * V * c.reactionTime + V ** 2 / (c.gradeK * (c.decel / c.gravity + G));
}

/**
 * The design value of a calculated SSD: up to the next 5 ft.
 * This matches all rows of GDHS Table 3-1 as quoted in [S3]. It is not a rule that GDHS states.
 */
export function designSSD(calculated) {
  return Math.ceil(calculated / 5 - 1e-9) * 5;
}

// ---------- Vertical curves ----------

/**
 * Minimum crest curve length. A in percent. The constant is 2158 for stopping and 2800 for passing.
 * Tries S < L first. If that result is shorter than S, the S > L case applies.
 */
export function crestLength(S, A, constant) {
  const long = (A * S ** 2) / constant;
  if (long >= S) return { L: long, case: 'S<L' };
  return { L: 2 * S - constant / A, case: 'S>L' };
}

/** Minimum sag curve length, headlight criterion. A in percent. */
export function sagLength(S, A, units = 'us') {
  const c = constants(units);
  const long = (A * S ** 2) / (c.sagBase + c.sagPerS * S);
  if (long >= S) return { L: long, case: 'S<L' };
  return { L: 2 * S - (c.sagBase + c.sagPerS * S) / A, case: 'S>L' };
}

/** Minimum sag curve length, comfort criterion. A in percent. */
export function sagComfortLength(A, V, units = 'us') {
  return (A * V ** 2) / constants(units).comfort;
}

/** The GDHS minimum vertical curve length for a speed, in feet. */
export function minCurveLength(V, units = 'us') {
  return constants(units).minLengthPerMph * V;
}

/**
 * An equal-tangent parabolic curve. Grades as decimals, stations and L in feet.
 * Returns the PVC and PVT, the elevation at a station, and the turning point (null if none on the curve).
 */
export function verticalCurve(pviStation, pviElevation, g1, g2, L) {
  const pvc = pviStation - L / 2;
  const pvt = pviStation + L / 2;
  const pvcElevation = pviElevation - (g1 * L) / 2;
  const pvtElevation = pviElevation + (g2 * L) / 2;
  const elevationAtX = (x) => pvcElevation + g1 * x + ((g2 - g1) * x ** 2) / (2 * L);
  const xTurn = (-g1 * L) / (g2 - g1);
  const turn = xTurn > 0 && xTurn < L ? { x: xTurn, station: pvc + xTurn, elevation: elevationAtX(xTurn) } : null;
  return {
    pvc,
    pvt,
    pvcElevation,
    pvtElevation,
    elevationAt: (station) => elevationAtX(station - pvc),
    turn,
  };
}

// ---------- Stations ----------

/** Station text from feet, for example 9840.51 to "98+40.51". */
export function formatStation(feet) {
  const cents = Math.round(feet * 100);
  const hundreds = Math.floor(cents / 10000);
  const rest = (cents - hundreds * 10000) / 100;
  return `${hundreds}+${rest.toFixed(2).padStart(5, '0')}`;
}

/** Feet from station text ("98+40.51") or a plain number ("9840.51"). null if neither. */
export function parseStation(text) {
  const s = String(text).trim().replace(/,/g, '');
  const m = /^(\d+)\s*\+\s*(\d{1,2}(?:\.\d*)?)$/.exec(s);
  if (m) return Number(m[1]) * 100 + Number(m[2]);
  return /^\d+(?:\.\d*)?$/.test(s) ? Number(s) : null;
}
