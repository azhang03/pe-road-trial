// The Field Book: the reference drawer of the game. No DOM.
// Our own words. No copied AASHTO tables. Citation rules: ../CONTENT.md, "Field Book".
// Equation numbers are given only where a public source quotes the GDHS 2018 number:
// Eqs. 3-2, 3-3, 3-37, 3-44 to 3-47 from the MDOT Sight Distance Guidelines ([S3] in CONTENT.md):
// https://mdotjboss.state.mi.us/stdplan/getStandardPlanDocument.htm?docGuid=7608e140-5def-4ad2-90c9-40e4abb822a5&fileName=MDOT_Sight%20Distance_Guidelines_Final.pdf
// The stations, degree, and curve entries are pure geometry. They cite the WSDOT Highway Surveying Manual, Chapter 11:
// https://wsdot.wa.gov/publications/manuals/fulltext/M22-97/Chapter11.pdf

export const FIELD_BOOK = [
  {
    id: 'stations',
    title: 'Stations',
    topic: 'horizontal',
    body: `<p>A station is a distance along the road. One station is 100 ft.</p>
<p><b>98+40.51</b> means 98 × 100 + 40.51 = 9,840.51 ft from the start.</p>
<p>Stations run along the alignment. On a curve, they follow the arc, not the tangents.</p>`,
    cite: 'Surveying practice. Public reference: WSDOT Highway Surveying Manual, Chapter 11.',
  },
  {
    id: 'degree',
    title: 'Degree of curve',
    topic: 'horizontal',
    body: `<p><b>Arc definition</b> (highways): D is the central angle of a 100 ft arc.</p>
<p class="pe-formula">R = 5729.58 / D</p>
<p><b>Chord definition</b> (mostly railroads): D is the central angle of a 100 ft chord.</p>
<p class="pe-formula">R = 50 / sin(D/2)</p>
<p>The two give almost the same R for usual values of D.</p>
<ul><li>R: radius (ft)</li><li>D: degree of curve (degrees)</li></ul>`,
    cite: 'Circular curve geometry. Public reference: WSDOT Highway Surveying Manual, Chapter 11.',
  },
  {
    id: 'curve',
    title: 'Circular curve elements',
    topic: 'horizontal',
    body: `<p class="pe-formula">T = R tan(Δ/2)</p>
<p class="pe-formula">L = π R Δ / 180</p>
<p class="pe-formula">LC = 2R sin(Δ/2)</p>
<p class="pe-formula">M = R (1 − cos(Δ/2))</p>
<p class="pe-formula">E = R (1 / cos(Δ/2) − 1)</p>
<p class="pe-formula">PC = PI − T &nbsp;&nbsp; PT = PC + L</p>
<ul>
<li>Δ: deflection angle (degrees), the angle between the two tangents</li>
<li>T: tangent length, PC to PI and PI to PT</li>
<li>L: curve length along the arc</li>
<li>LC: long chord, PC to PT in a straight line</li>
<li>M: middle ordinate, from the curve midpoint to the long chord midpoint</li>
<li>E: external distance, from the PI to the curve midpoint</li>
</ul>
<p>The PT is PC + L, not PI + T: stations follow the arc.</p>`,
    cite: 'Circular curve geometry. Public reference: WSDOT Highway Surveying Manual, Chapter 11.',
  },
  {
    id: 'friction',
    title: 'Superelevation and side friction',
    topic: 'horizontal',
    body: `<p class="pe-formula">0.01e + f = V² / (15R)</p>
<p class="pe-formula">R_min = V² / (15 (0.01e_max + f_max))</p>
<ul>
<li>e: superelevation (percent)</li>
<li>f: side friction factor (decimal)</li>
<li>V: speed (mph)</li>
<li>R: radius (ft)</li>
</ul>
<p>The constant 15 turns mph into ft/s and includes g. Do not convert V again.</p>
<p>f_max goes down as the design speed goes up. Questions give f_max.</p>`,
    cite: 'GDHS 2018, Chapter 3, Horizontal alignment (superelevation and side friction).',
  },
  {
    id: 'sightline',
    title: 'Horizontal sightline offset',
    topic: 'horizontal',
    body: `<p class="pe-formula">HSO = R [1 − cos(28.65 S / R)]</p>
<ul>
<li>HSO: distance from the centerline of the inside lane to the sight obstruction (ft)</li>
<li>R: radius to the centerline of the inside lane (ft)</li>
<li>S: sight distance (ft)</li>
</ul>
<p>The angle 28.65 S / R is in degrees.</p>
<p>The formula applies when the curve is longer than S.</p>
<p>On a two-lane road with 12 ft lanes, the inside lane centerline is 6 ft inside the road centerline.</p>`,
    cite: 'GDHS 2018, Chapter 3, Sight distance on horizontal curves (Eq. 3-37, as quoted by MDOT).',
  },
  {
    id: 'runoff',
    title: 'Superelevation transition',
    topic: 'horizontal',
    body: `<p><b>Runoff</b>: the outside lane goes from level to the full superelevation.</p>
<p class="pe-formula">L_r = (w n₁ e_d / Δ) b_w</p>
<p><b>Tangent runout</b>: the outside lane goes from the normal crown to level.</p>
<p class="pe-formula">L_t = (e_NC / e_d) L_r</p>
<ul>
<li>w: width of one lane (ft)</li>
<li>n₁: number of lanes rotated</li>
<li>e_d: design superelevation (percent)</li>
<li>Δ: maximum relative gradient (percent). It goes down as the speed goes up.</li>
<li>b_w: adjustment factor for the number of lanes rotated (1.00 for one lane)</li>
<li>e_NC: normal cross slope (percent)</li>
</ul>
<p>Keep e_d and Δ in the same units (both in percent).</p>`,
    cite: 'GDHS 2018, Chapter 3, Superelevation transition.',
  },
  {
    id: 'ssd',
    title: 'Stopping sight distance',
    topic: 'vertical',
    body: `<p><b>Level road</b></p>
<p class="pe-formula">SSD = 1.47 V t + 1.075 V² / a</p>
<p><b>On a grade</b></p>
<p class="pe-formula">SSD = 1.47 V t + V² / [30 (a / 32.2 ± G)]</p>
<ul>
<li>V: design speed (mph)</li>
<li>t: brake reaction time, 2.5 s</li>
<li>a: deceleration rate, 11.2 ft/s²</li>
<li>G: grade as a decimal, + uphill, − downhill</li>
</ul>
<p>The first term is the reaction distance. The second is the braking distance.</p>
<p>Design values round the calculated SSD up to the next 5 ft. (This matches GDHS Table 3-1 as quoted by MDOT.)</p>`,
    cite: 'GDHS 2018, Chapter 3, Stopping sight distance (Eqs. 3-2 and 3-3, as quoted by MDOT).',
  },
  {
    id: 'crest',
    title: 'Crest vertical curves',
    topic: 'vertical',
    body: `<p><b>Stopping sight distance</b> (eye 3.5 ft, object 2.0 ft)</p>
<p class="pe-formula">S &lt; L: L = A S² / 2158</p>
<p class="pe-formula">S &gt; L: L = 2S − 2158 / A</p>
<p><b>Passing sight distance</b> (eye 3.5 ft, object 3.5 ft)</p>
<p class="pe-formula">S &lt; L: L = A S² / 2800</p>
<p class="pe-formula">S &gt; L: L = 2S − 2800 / A</p>
<ul>
<li>A: algebraic difference in grades, |g₂ − g₁| (percent)</li>
<li>S: sight distance (ft)</li>
<li>L: curve length (ft)</li>
</ul>
<p>Try S &lt; L first. If the result is shorter than S, use S &gt; L.</p>
<p class="pe-formula">K = L / A &nbsp;&nbsp; L = K A</p>`,
    cite: 'GDHS 2018, Chapter 3, Crest vertical curves (Eqs. 3-44 to 3-47, as quoted by MDOT).',
  },
  {
    id: 'sag',
    title: 'Sag vertical curves',
    topic: 'vertical',
    body: `<p><b>Headlight criterion</b> (headlight 2.0 ft, beam 1° up)</p>
<p class="pe-formula">S &lt; L: L = A S² / (400 + 3.5 S)</p>
<p class="pe-formula">S &gt; L: L = 2S − (400 + 3.5 S) / A</p>
<p><b>Comfort criterion</b> (mostly for roads with lights)</p>
<p class="pe-formula">L = A V² / 46.5</p>
<ul>
<li>A: algebraic difference in grades (percent)</li>
<li>S: sight distance (ft)</li>
<li>V: design speed (mph)</li>
</ul>
<p>Try S &lt; L first. If the result is shorter than S, use S &gt; L.</p>`,
    cite: 'GDHS 2018, Chapter 3, Sag vertical curves.',
  },
  {
    id: 'vcurve',
    title: 'Vertical curve geometry',
    topic: 'vertical',
    body: `<p>An equal-tangent parabola. The PVI is halfway between the PVC and the PVT.</p>
<p class="pe-formula">PVC = PVI − L/2 &nbsp;&nbsp; PVT = PVI + L/2</p>
<p class="pe-formula">y_PVC = y_PVI − g₁ L/2</p>
<p class="pe-formula">y = y_PVC + g₁ x + (g₂ − g₁) x² / (2L)</p>
<p class="pe-formula">High or low point: x = −g₁ L / (g₂ − g₁)</p>
<ul>
<li>x: distance from the PVC</li>
<li>g₁, g₂: grades in and out</li>
<li>Units: g as a decimal with x and L in ft, or g in percent with x and L in stations</li>
</ul>
<p class="pe-formula">K = L / A</p>
<p>Minimum length of any vertical curve: about 3V ft (V in mph).</p>`,
    cite: 'GDHS 2018, Chapter 3, Vertical alignment.',
  },
];
