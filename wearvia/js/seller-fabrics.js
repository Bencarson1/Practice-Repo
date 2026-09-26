// ============================================================
// seller-fabrics.js — NebedaHub Admin → Fabric sellers: the admin checks the
// fabrics sellers upload. Approve puts a fabric live in the
// marketplace; Hide takes it down (the seller sees the reason).
// ============================================================

let sellerFabricFilter = "Waiting";

function renderSellerFabrics() {
  const all = activeFabrics().slice().sort((a, b) =>
    String(b.created_at || "").localeCompare(String(a.created_at || "")) || (Number(b.id.slice(1)) || 0) - (Number(a.id.slice(1)) || 0));
  const waiting = all.filter(f => f.status === "pending");
  const tests = {
    Waiting: f => f.status === "pending",
    Live: f => f.status === "approved" && !isSoldOut(f),
    Hidden: f => f.status === "hidden",
    "Sold out": f => f.status === "approved" && isSoldOut(f),
    All: () => true
  };
  const shown = all.filter(tests[sellerFabricFilter] || tests.All);

  const cards = shown.map(f => {
    const seller = findSupplier(f.supplier_id);
    const photos = fabricPhotoRefs(f);
    return `
      <div class="review-card">
        <div class="review-photos">${photos.map((ref, i) => `<img src="${photoUrl(ref)}" alt="${escapeHtml(f.name)} photo ${i + 1}" loading="lazy">`).join("")}</div>
        <div class="review-body">
          <div class="row-between wrap"><h3>${escapeHtml(f.name)}</h3>${sellerStatusBadge(f)}</div>
          <p class="muted">${escapeHtml(f.category)} · ${escapeHtml(f.colour_name)} · ${photos.length} photo${photos.length === 1 ? "" : "s"}${f.photos && f.photos.length ? "" : " (no photos — showing a swatch)"}</p>
          <p><strong class="gold">${escapeHtml(fabricPriceText(f, sellerFabricUnit(seller)))}</strong> · ${lengthText(f.yards_available, sellerFabricUnit(seller))} in stock · min ${lengthText(f.min_order_yards, sellerFabricUnit(seller))}</p>
          <p>Seller: <b>${escapeHtml(seller ? seller.name : "—")}</b>${seller ? ` · ${escapeHtml(seller.location)} · ${escapeHtml(seller.phone || "")}` : ""}</p>
          ${f.description ? `<p class="desc">${escapeHtml(f.description)}</p>` : ""}
          ${f.status === "hidden" && f.review_note ? `<p class="review-note">Reason given: “${escapeHtml(f.review_note)}”</p>` : ""}
          <div class="job-buttons">
            ${f.status !== "approved" ? `<button class="small gold" onclick="approveSellerFabric('${f.id}')">✓ Approve</button>` : ""}
            ${f.status !== "hidden" ? `<button class="small danger" onclick="hideSellerFabric('${f.id}')">Hide</button>` : ""}
          </div>
        </div>
      </div>`;
  }).join("");

  const sellerRows = db.suppliers.map(s => {
    const fabrics = sellerFabrics(s.id);
    const orders = sellerOrders(s.id).filter(o => o.status !== "cancelled");
    return `<tr>
      <td><img class="logo tiny" src="${sellerLogoUrl(s)}" alt=""> ${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.location)}</td><td class="nowrap">${escapeHtml(s.phone || "—")}</td><td>${escapeHtml(s.delivery_estimate)}</td>
      <td>${fabrics.filter(f => f.status === "approved").length} live / ${fabrics.length}</td>
      <td>${fabrics.filter(f => f.status === "pending").length || "—"}</td>
      <td>${orders.length} · ${escapeHtml(totalsText(sumByCurrency(orders, o => o.total, o => o.currency_code || sellerCurrency(s)), sellerCurrency(s)))}</td>
    </tr>`;
  }).join("");

  return `
    ${bizHeader("Fabric Sellers", `Check fabrics from independent sellers before customers see them in the Fabric Marketplace.`)}
    ${waiting.length ? `<div class="alerts"><span class="alert">${waiting.length} fabric${waiting.length > 1 ? "s" : ""} waiting for approval</span></div>` : ""}
    <div class="chips">${Object.keys(tests).map(k =>
      `<button class="chip ${k === sellerFabricFilter ? "active" : ""}" onclick="sellerFabricFilter='${k}';renderAll()">${k} (${all.filter(tests[k]).length})</button>`).join("")}</div>
    ${shown.length ? `<div class="review-grid">${cards}</div>` : `<div class="card"><p class="empty">${sellerFabricFilter === "Waiting" ? "Nothing waiting — you're up to date." : "No fabrics here."}</p></div>`}
    <div class="card">
      <h2>Sellers</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Shop</th><th>Location</th><th>Phone</th><th>Delivery</th><th>Fabrics</th><th>Waiting</th><th>Orders · sales</th></tr></thead>
        <tbody>${sellerRows}</tbody>
      </table></div>
    </div>`;
}

function approveSellerFabric(fabricId) {
  const fabric = reviewFabric(fabricId, "approved");
  saveData();
  toast(`${fabric.name} is live in the Fabric Marketplace.`);
  renderAll();
}

function hideSellerFabric(fabricId) {
  const fabric = findFabric(fabricId);
  const reason = prompt(`Hide ${fabric.name} from customers? Tell the seller why (optional):`, "");
  if (reason === null) return;
  reviewFabric(fabricId, "hidden", reason.trim());
  saveData();
  toast(`${fabric.name} is hidden from customers.`);
  renderAll();
}
