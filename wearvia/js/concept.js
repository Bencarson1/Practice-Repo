// ============================================================
// concept.js — draws the design concept from the customer's choices
// (outfit, colour, embroidery, sleeve, neck). "Regenerate" changes
// the variation number, which changes the embroidery pattern, collar
// details, hem and length, pockets and trim, fabric print and backdrop.
// Every detail changes from one variation to the next, while the
// customer's own choices always stay the same.
// In the full version this is where an image-generation API plugs in.
// ============================================================

// Picks option number 0..count-1 for this variation. "step" is never a
// multiple of "count", so the next variation always picks a different option.
function conceptPick(v, count, step) {
  return ((v - 1) * step) % count;
}

// Background colours and backdrop shapes
const CONCEPT_BACKDROPS = [
  { from: "#faf6ec", to: "#eadfc4", shape: "floor" },
  { from: "#f4f6fa", to: "#d6dde8", shape: "arch" },
  { from: "#fbf3ee", to: "#ecd2c6", shape: "spot" },
  { from: "#f2f6f1", to: "#cfdccd", shape: "drape" },
  { from: "#f7f3fa", to: "#ddd3e6", shape: "frame" },
  { from: "#fdf8e8", to: "#efdca4", shape: "rays" }
];

function conceptSVG(design, variation) {
  const v = Math.max(1, Math.floor(variation) || 1);
  const colour = design.colour;
  const trim = design.embroidery === "Gold" ? "#e0bb5c" : design.embroidery === "Silver" ? "#d3d8e0" : null;
  const outfit = design.outfit;
  const flared = ["Dress", "Bubu", "Aso Ebi"].includes(outfit);
  const long = flared || ["Agbada", "Kaftan", "Wedding"].includes(outfit);
  const wideSleeve = design.sleeve === "Wide";
  const vNeck = design.neck === "V-neck";
  const light = ["#efe6d2", "#c9a24a"].includes(colour);
  const edge = light ? "rgba(0,0,0,.25)" : "rgba(255,255,255,.18)";
  // Tonal stitching and details: used when there's no embroidery
  const tone = light ? "rgba(0,0,0,.32)" : "rgba(255,255,255,.32)";
  const ink = light ? "rgba(0,0,0,.13)" : "rgba(255,255,255,.12)";
  const detail = trim || tone;
  const id = "c" + Math.random().toString(36).slice(2, 7);

  // What this variation looks like (each changes on every regeneration)
  const embStyle = conceptPick(v, 5, 2);
  const collarStyle = conceptPick(v, 5, 3);
  const hemStyle = conceptPick(v, 4, 1);
  const lengthStyle = conceptPick(v, 3, 1);
  const pocketStyle = conceptPick(v, 5, 1);
  const printStyle = conceptPick(v, 6, 5);
  const backdrop = CONCEPT_BACKDROPS[conceptPick(v, 6, 1)];

  // Length: long outfits stay long, tops stay tops
  const hemY = long ? [272, 258, 282][lengthStyle] : [186, 174, 200][lengthStyle];
  // Half-width of the garment at the hem
  let hemX;
  if (flared) hemX = 22 + 38 * (hemY - 128) / 144;
  else if (long) hemX = 30 + 20 * (hemY - 62) / 210;
  else hemX = 30 + 6 * (hemY - 62) / 124;
  const xL = +(100 - hemX).toFixed(1);
  const xR = +(100 + hemX).toFixed(1);

  // Hem shape: straight, curved, side slits or pointed
  let hem;
  if (hemStyle === 1) hem = `Q100,${hemY + 12} ${xL},${hemY}`;
  else if (hemStyle === 2) hem = `L${xR - 5},${hemY - 20} L${xR - 10},${hemY} L${xL + 10},${hemY} L${xL + 5},${hemY - 20} L${xL},${hemY}`;
  else if (hemStyle === 3) hem = `L100,${hemY + 12} L${xL},${hemY}`;
  else hem = `L${xL},${hemY}`;

  // Garment body
  let body;
  if (flared) body = `M74,62 L126,62 L122,128 L${xR},${hemY} ${hem} L78,128 Z`;
  else body = `M70,62 L130,62 L${xR},${hemY} ${hem} Z`;

  // Sleeves
  const sleeves = wideSleeve
    ? "M71,64 L18,150 L50,168 L76,104 Z M129,64 L182,150 L150,168 L124,104 Z"
    : "M71,64 L52,158 L65,161 L78,98 Z M129,64 L148,158 L135,161 L122,98 Z";

  // Trousers for shorter tops
  const legs = "M73,176 L99,176 L97,284 L79,284 Z M101,176 L127,176 L121,284 L103,284 Z";
  const trousers = long ? "" : `
    <path d="${legs}" fill="${colour}"/>
    <path d="${legs}" fill="url(#${id}pr)"/>
    <path d="${legs}" fill="rgba(0,0,0,.18)"/>`;

  // Neckline (shape always follows the customer's choice)
  const neck = vNeck ? "M86,62 L100,92 L114,62" : "M86,62 Q100,82 114,62";
  const neckBottom = vNeck ? 92 : 72;

  // Fabric texture or print
  const prints = [
    `<rect width="8" height="8" fill="none"/><path d="M0,8 L8,0" stroke="${ink}" stroke-width=".5"/>`,
    `<rect width="6" height="6" fill="none"/><line x1="3" y1="0" x2="3" y2="6" stroke="${ink}" stroke-width=".8"/>`,
    `<rect width="10" height="10" fill="none"/><circle cx="2.5" cy="2.5" r="1.4" fill="${ink}"/><circle cx="7.5" cy="7.5" r="1.4" fill="${ink}"/>`,
    `<rect width="12" height="12" fill="none"/><path d="M6,1 L11,6 L6,11 L1,6 Z" fill="none" stroke="${ink}" stroke-width=".8"/><circle cx="6" cy="6" r="1.2" fill="${ink}"/>`,
    `<rect width="12" height="8" fill="none"/><path d="M0,6 L3,2 L6,6 L9,2 L12,6" fill="none" stroke="${ink}" stroke-width="1"/>`,
    `<rect width="14" height="14" fill="none"/><circle cx="7" cy="7" r="4.5" fill="none" stroke="${ink}" stroke-width=".8"/><circle cx="0" cy="0" r="2" fill="${ink}"/><circle cx="14" cy="0" r="2" fill="${ink}"/><circle cx="0" cy="14" r="2" fill="${ink}"/><circle cx="14" cy="14" r="2" fill="${ink}"/>`
  ];
  const printSize = [[8, 8], [6, 6], [10, 10], [12, 12], [12, 8], [14, 14]][printStyle];

  // Collar and neckline details
  let collar = "";
  if (collarStyle === 1) {
    // Band (mandarin) collar
    collar = `<path d="M84,56 L116,56 L116,64 L84,64 Z" fill="${colour}" stroke="${detail}" stroke-width="1.4"/>`;
  } else if (collarStyle === 2) {
    // Double piping round the neckline
    const inner = vNeck ? "M89,62 L100,86 L111,62" : "M89,62 Q100,77 111,62";
    collar = `<path d="${inner}" fill="none" stroke="${detail}" stroke-width="1.4"/>`;
  } else if (collarStyle === 3) {
    // Button placket below the neck
    const top = neckBottom + 2;
    collar = `<line x1="100" y1="${top}" x2="100" y2="${top + 38}" stroke="${detail}" stroke-width="1.2"/>`;
    for (let y = top + 6; y < top + 38; y += 10) collar += `<circle cx="100" cy="${y}" r="2" fill="${detail}"/>`;
  } else if (collarStyle === 4) {
    // Keyhole slit with a tie
    collar = `<path d="M100,${neckBottom} L100,${neckBottom + 18}" stroke="${detail}" stroke-width="1.6"/>
              <path d="M100,${neckBottom + 2} q-7,3 -9,10 M100,${neckBottom + 2} q7,3 9,10" fill="none" stroke="${detail}" stroke-width="1.4" stroke-linecap="round"/>`;
  }

  // Pockets and trim
  let pockets = "";
  const pocketY = long ? Math.min(hemY - 70, 190) : hemY - 44;
  if (pocketStyle === 1) {
    // Chest pocket
    pockets = `<path d="M110,${neckBottom + 16} h16 v14 h-16 Z" fill="none" stroke="${detail}" stroke-width="1.3"/>`;
  } else if (pocketStyle === 2) {
    // Two patch pockets
    pockets = `<path d="M${100 - hemX + 10},${pocketY} h20 v18 q-10,5 -20,0 Z M${100 + hemX - 30},${pocketY} h20 v18 q-10,5 -20,0 Z" fill="none" stroke="${detail}" stroke-width="1.3"/>`;
  } else if (pocketStyle === 3) {
    // Contrast cuffs on the sleeves
    pockets = wideSleeve
      ? `<path d="M18,150 L50,168 L46,176 L13,158 Z M182,150 L150,168 L154,176 L187,158 Z" fill="${detail}"/>`
      : `<path d="M52,158 L65,161 L64,169 L50,166 Z M148,158 L135,161 L136,169 L150,166 Z" fill="${detail}"/>`;
  } else if (pocketStyle === 4) {
    // Piping down both side seams
    const topX = flared ? 26 : 30;
    pockets = `<path d="M${100 - topX + 3},66 L${xL + 4},${hemY - 3} M${100 + topX - 3},66 L${xR - 4},${hemY - 3}" fill="none" stroke="${detail}" stroke-width="1.1" stroke-dasharray="4 2"/>`;
  }

  // Embroidery pattern (only when the customer chose embroidery)
  let pattern = "";
  if (trim) {
    const bottom = hemY - 20;
    if (embStyle === 0) {
      for (let y = neckBottom + 8; y < bottom; y += 14) pattern += `<circle cx="100" cy="${y}" r="3" fill="${trim}"/>`;
    } else if (embStyle === 1) {
      let points = "";
      for (let y = neckBottom + 6, i = 0; y < bottom; y += 9, i++) points += `${i % 2 ? 107 : 93},${y} `;
      pattern = `<polyline points="${points}" fill="none" stroke="${trim}" stroke-width="2.2"/>`;
    } else if (embStyle === 2) {
      pattern = `<path d="M84,64 L84,128 Q100,140 116,128 L116,64" fill="none" stroke="${trim}" stroke-width="2.4"/>
                 <path d="M90,70 L90,122 Q100,130 110,122 L110,70" fill="none" stroke="${trim}" stroke-width="1.2" stroke-dasharray="3 3"/>`;
    } else if (embStyle === 3) {
      // Swirls across the chest
      pattern = `<path d="M80,${neckBottom + 14} c6,-10 16,-10 20,0 c4,10 14,10 20,0 M86,${neckBottom + 26} c4,-6 10,-6 14,0 c4,6 10,6 14,0" fill="none" stroke="${trim}" stroke-width="2" stroke-linecap="round"/>
                 <circle cx="100" cy="${neckBottom + 38}" r="4" fill="none" stroke="${trim}" stroke-width="1.8"/>`;
    } else {
      // Band of diamonds above the hem
      const y = hemY - 24;
      for (let x = 100 - hemX + 12; x <= 100 + hemX - 12; x += 12) {
        pattern += `<path d="M${x.toFixed(1)},${y - 6} l6,6 l-6,6 l-6,-6 Z" fill="none" stroke="${trim}" stroke-width="1.6"/>`;
      }
    }
    pattern += `<path d="${neck}" fill="none" stroke="${trim}" stroke-width="4" stroke-linecap="round"/>`;
    pattern += `<line x1="${xL + 4}" y1="${hemY - 6}" x2="${xR - 4}" y2="${hemY - 6}" stroke="${trim}" stroke-width="3" stroke-dasharray="${v % 2 ? "6 3" : "2 3"}"/>`;
    if (wideSleeve) {
      pattern += `<path d="M22,146 L50,162 M178,146 L150,162" stroke="${trim}" stroke-width="3"/>`;
    }
  }

  // Backdrop shape
  let scene = "";
  if (backdrop.shape === "floor") scene = `<rect y="250" width="200" height="50" fill="rgba(0,0,0,.05)"/>`;
  else if (backdrop.shape === "arch") scene = `<path d="M30,300 L30,110 A70,70 0 0 1 170,110 L170,300 Z" fill="rgba(255,255,255,.55)"/>`;
  else if (backdrop.shape === "spot") scene = `<circle cx="100" cy="130" r="95" fill="rgba(255,255,255,.5)"/>`;
  else if (backdrop.shape === "drape") scene = `<path d="M0,0 Q18,150 0,300 L0,0 Z M200,0 Q182,150 200,300 L200,0 Z" fill="rgba(0,0,0,.08)"/><path d="M0,0 L200,0 L200,10 L0,10 Z" fill="rgba(0,0,0,.06)"/>`;
  else if (backdrop.shape === "frame") scene = `<rect x="14" y="14" width="172" height="272" rx="6" fill="none" stroke="rgba(0,0,0,.12)" stroke-width="1.5"/>`;
  else scene = `<path d="M100,140 L0,0 L40,0 Z M100,140 L80,0 L120,0 Z M100,140 L160,0 L200,0 Z M100,140 L200,70 L200,120 Z M100,140 L0,70 L0,120 Z" fill="rgba(255,255,255,.35)"/>`;

  return `
  <svg viewBox="0 0 200 300" role="img" aria-label="Design concept: ${escapeHtml(colourName(colour))} ${escapeHtml(outfit)}, ${escapeHtml(design.embroidery)} embroidery, ${escapeHtml(design.sleeve)} sleeve, ${escapeHtml(design.neck)}">
    <defs>
      <linearGradient id="${id}bg" gradientTransform="rotate(${(v * 47) % 180} .5 .5)">
        <stop offset="0" stop-color="${backdrop.from}"/>
        <stop offset="1" stop-color="${backdrop.to}"/>
      </linearGradient>
      <linearGradient id="${id}sh" x1="0" x2="1">
        <stop offset="0" stop-color="rgba(255,255,255,.14)"/>
        <stop offset=".5" stop-color="rgba(255,255,255,0)"/>
        <stop offset="1" stop-color="rgba(0,0,0,.18)"/>
      </linearGradient>
      <pattern id="${id}pr" patternUnits="userSpaceOnUse" width="${printSize[0]}" height="${printSize[1]}">${prints[printStyle]}</pattern>
    </defs>
    <rect width="200" height="300" fill="url(#${id}bg)"/>
    ${scene}
    <ellipse cx="100" cy="290" rx="64" ry="6" fill="rgba(0,0,0,.08)"/>
    <circle cx="100" cy="38" r="15" fill="#d8cbb0"/>
    <rect x="94" y="50" width="12" height="14" fill="#d8cbb0"/>
    ${trousers}
    <path d="${sleeves}" fill="${colour}" stroke="${edge}"/>
    <path d="${sleeves}" fill="url(#${id}pr)"/>
    <path d="${body}" fill="${colour}" stroke="${edge}"/>
    <path d="${body}" fill="url(#${id}pr)"/>
    <path d="${body}" fill="url(#${id}sh)"/>
    <path d="${neck}" fill="none" stroke="${edge}" stroke-width="2"/>
    ${collar}
    ${pockets}
    ${pattern}
  </svg>`;
}
