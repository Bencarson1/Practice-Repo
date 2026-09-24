// ============================================================
// concept.js — draws the design concept from the customer's choices
// (outfit, colour, embroidery, sleeve, neck). "Regenerate" changes
// the variation number, which changes the embroidery pattern and backdrop.
// In the full version this is where an image-generation API plugs in.
// ============================================================

function conceptSVG(design, variation) {
  const v = variation || 1;
  const colour = design.colour;
  const trim = design.embroidery === "Gold" ? "#e0bb5c" : design.embroidery === "Silver" ? "#d3d8e0" : null;
  const outfit = design.outfit;
  const flared = ["Dress", "Bubu", "Aso Ebi"].includes(outfit);
  const long = flared || ["Agbada", "Kaftan", "Wedding"].includes(outfit);
  const wideSleeve = design.sleeve === "Wide";
  const light = ["#efe6d2", "#c9a24a"].includes(colour);
  const edge = light ? "rgba(0,0,0,.25)" : "rgba(255,255,255,.18)";
  const id = "c" + Math.random().toString(36).slice(2, 7);

  // Garment body
  let body;
  if (flared) body = "M74,62 L126,62 L122,128 L160,272 L40,272 L78,128 Z";
  else if (long) body = "M70,62 L130,62 L150,272 L50,272 Z";
  else body = "M70,62 L130,62 L136,186 L64,186 Z";
  const hemY = long ? 272 : 186;

  // Sleeves
  const sleeves = wideSleeve
    ? "M71,64 L18,150 L50,168 L76,104 Z M129,64 L182,150 L150,168 L124,104 Z"
    : "M71,64 L52,158 L65,161 L78,98 Z M129,64 L148,158 L135,161 L122,98 Z";

  // Trousers for shorter tops
  const trousers = long ? "" : `
    <path d="M73,186 L99,186 L97,284 L79,284 Z M101,186 L127,186 L121,284 L103,284 Z" fill="${colour}"/>
    <path d="M73,186 L99,186 L97,284 L79,284 Z M101,186 L127,186 L121,284 L103,284 Z" fill="rgba(0,0,0,.18)"/>`;

  // Neckline
  const neck = design.neck === "V-neck" ? "M86,62 L100,92 L114,62" : "M86,62 Q100,82 114,62";

  // Embroidery pattern changes with each regeneration
  let pattern = "";
  if (trim) {
    const style = (v - 1) % 3;
    if (style === 0) {
      for (let y = 100; y < hemY - 20; y += 14) pattern += `<circle cx="100" cy="${y}" r="3" fill="${trim}"/>`;
    } else if (style === 1) {
      let points = "";
      for (let y = 98, i = 0; y < hemY - 20; y += 9, i++) points += `${i % 2 ? 107 : 93},${y} `;
      pattern = `<polyline points="${points}" fill="none" stroke="${trim}" stroke-width="2.2"/>`;
    } else {
      pattern = `<path d="M84,64 L84,128 Q100,140 116,128 L116,64" fill="none" stroke="${trim}" stroke-width="2.4"/>
                 <path d="M90,70 L90,122 Q100,130 110,122 L110,70" fill="none" stroke="${trim}" stroke-width="1.2" stroke-dasharray="3 3"/>`;
    }
    pattern += `<path d="${neck}" fill="none" stroke="${trim}" stroke-width="4" stroke-linecap="round"/>`;
    pattern += `<line x1="${long ? (flared ? 44 : 53) : 66}" y1="${hemY - 6}" x2="${long ? (flared ? 156 : 147) : 134}" y2="${hemY - 6}" stroke="${trim}" stroke-width="3" stroke-dasharray="${v % 2 ? "6 3" : "2 3"}"/>`;
    if (wideSleeve) {
      pattern += `<path d="M22,146 L50,162 M178,146 L150,162" stroke="${trim}" stroke-width="3"/>`;
    }
  }

  const angle = (v * 47) % 180;
  return `
  <svg viewBox="0 0 200 300" role="img" aria-label="Design concept: ${escapeHtml(colourName(colour))} ${escapeHtml(outfit)}, ${escapeHtml(design.embroidery)} embroidery, ${escapeHtml(design.sleeve)} sleeve, ${escapeHtml(design.neck)}">
    <defs>
      <linearGradient id="${id}bg" gradientTransform="rotate(${angle} .5 .5)">
        <stop offset="0" stop-color="#faf6ec"/>
        <stop offset="1" stop-color="${v % 2 ? "#eadfc4" : "#dfe3ea"}"/>
      </linearGradient>
      <linearGradient id="${id}sh" x1="0" x2="1">
        <stop offset="0" stop-color="rgba(255,255,255,.14)"/>
        <stop offset=".5" stop-color="rgba(255,255,255,0)"/>
        <stop offset="1" stop-color="rgba(0,0,0,.18)"/>
      </linearGradient>
    </defs>
    <rect width="200" height="300" fill="url(#${id}bg)"/>
    <ellipse cx="100" cy="290" rx="64" ry="6" fill="rgba(0,0,0,.08)"/>
    <circle cx="100" cy="38" r="15" fill="#d8cbb0"/>
    <rect x="94" y="50" width="12" height="14" fill="#d8cbb0"/>
    ${trousers}
    <path d="${sleeves}" fill="${colour}" stroke="${edge}"/>
    <path d="${body}" fill="${colour}" stroke="${edge}"/>
    <path d="${body}" fill="url(#${id}sh)"/>
    <path d="${neck}" fill="none" stroke="${edge}" stroke-width="2"/>
    ${pattern}
  </svg>`;
}
