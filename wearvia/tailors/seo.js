// The public tailor pages: after the page (built from the database each day)
// has loaded, fetch the latest from Wearvia so ratings, new tailors,
// portfolios and reviews are always current. Uses the public publishable key
// and only public information (js/config.js).
(function () {
  const P = window.WEARVIA_PAGE;
  if (!P || typeof SUPABASE_URL === "undefined") return;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rpc = (name, args) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  }).then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
  const rating = t => t.review_count > 0 && t.rating ? `${Number(t.rating).toFixed(1)}★ (${t.review_count} review${t.review_count === 1 ? "" : "s"})` : "New on Wearvia";
  const initials = n => String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");

  if (P.kind === "city") {
    rpc("wearvia_search_tailors", { p_country: P.country, p_city: P.city, p_sort: "rating", p_limit: 50 }).then(rows => {
      const list = document.getElementById("live-list");
      const count = document.querySelector("[data-live=count]");
      if (!list || !rows) return;
      if (count) count.textContent = rows.length ? `${rows[0].total_count} tailor${rows[0].total_count == 1 ? "" : "s"} in ${P.city}` : `Tailors in ${P.city}`;
      if (!rows.length) return;
      list.innerHTML = rows.map(t => `<li class="card"><a href="${P.root}tailor/${esc(t.slug)}/">
        ${t.profile_image_url ? `<img src="${esc(t.profile_image_url)}" alt="" loading="lazy" width="56" height="56">` : `<span class="initials" aria-hidden="true">${esc(initials(t.business_name))}</span>`}
        <span class="card-text"><b>${esc(t.business_name)}</b><span>${esc([t.city, t.postcode_area].filter(Boolean).join(" · "))}</span>
          <span>${esc((t.speciality_tags || []).join(", ") || "Tailoring")}</span>
          <span class="gold">${esc(rating(t))}${t.delivery_available ? " · Delivers" : ""}${t.custom_orders ? " · Custom orders" : ""}</span></span></a></li>`).join("");
    }).catch(() => { /* the list built into the page stays */ });
  }

  if (P.kind === "tailor") {
    rpc("wearvia_tailor_page", { p_slug: P.slug }).then(t => {
      if (!t) return;
      const r = document.querySelector("[data-live=rating]");
      if (r) r.textContent = rating(t);
      const portfolio = document.getElementById("live-portfolio");
      if (portfolio && (t.portfolio || []).length) {
        portfolio.innerHTML = `<h2>Portfolio</h2><div class="portfolio">${t.portfolio.map(p => `<img src="${esc(p.image_url)}" alt="${esc(p.title || "Outfit by " + t.business_name)}" loading="lazy">`).join("")}</div>`;
      }
      const reviews = document.getElementById("live-reviews");
      if (reviews && (t.reviews || []).length) {
        reviews.innerHTML = `<h2>Reviews</h2>${t.reviews.slice(0, 10).map(v => `<div class="review"><span class="gold">${"★".repeat(v.rating)}</span> ${esc(v.text || v.outfit || "")}<small>${esc(v.who)}${v.outfit ? " · " + esc(v.outfit) : ""}</small></div>`).join("")}`;
      }
    }).catch(() => { /* the page still works without the live details */ });
  }
})();
