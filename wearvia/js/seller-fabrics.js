// ============================================================
// seller-fabrics.js — NebedaHub Admin → Seller fabrics
//
// Admin moderation uses three safe levels:
//   Hide      removes a fabric from customers but keeps it editable.
//   Archive   removes it from the marketplace and normal admin inventory.
//   Restore   brings an archived item back as hidden so it can be reviewed
//             before being made live again.
// ============================================================

let sellerFabricFilter = "Waiting";

function fabricIsArchived(fabric) {
  return !!(fabric && fabric.deleted_at);
}

function renderSellerFabrics() {
  const all = (db.fabrics || []).slice().sort((a, b) =>
    String(b.created_at || "").localeCompare(String(a.created_at || "")) || String(b.id).localeCompare(String(a.id)));
  const waiting = all.filter(f => !fabricIsArchived(f) && f.status === "pending");
  const tests = {
    Waiting: f => !fabricIsArchived(f) && f.status === "pending",
    Live: f => !fabricIsArchived(f) && f.status === "approved" && !isSoldOut(f),
    Hidden: f => !fabricIsArchived(f) && f.status === "hidden",
    "Sold out": f => !fabricIsArchived(f) && f.status === "approved" && isSoldOut(f),
    Archived: f => fabricIsArchived(f),
    All: () => true
  };
  const shown = all.filter(tests[sellerFabricFilter] || tests.All);

  const cards = shown.map(f => {
    const seller = findSupplier(f.supplier_id);
    const photos = fabricPhotoRefs(f);
    const archived = fabricIsArchived(f);
    return `
      <div class="review-card ${archived ? "is-archived" : ""}">
        <div class="review-photos">${photos.map((ref, i) => `<img src="${photoUrl(ref)}" alt="${escapeHtml(f.name)} photo ${i + 1}" loading="lazy">`).join("")}</div>
        <div class="review-body">
          <div class="row-between wrap"><h3>${escapeHtml(f.name)}</h3>${archived ? `<span class="badge">Archived</span>` : sellerStatusBadge(f)}</div>
          <p class="muted">${escapeHtml(f.category)} · ${escapeHtml(f.colour_name)} · ${photos.length} photo${photos.length === 1 ? "" : "s"}${f.photos && f.photos.length ? "" : " (no photos — showing a swatch)"}</p>
          <p><strong class="gold">${escapeHtml(fabricPriceText(f, sellerFabricUnit(seller)))}</strong> · ${lengthText(f.yards_available, sellerFabricUnit(seller))} in stock · min ${lengthText(f.min_order_yards, sellerFabricUnit(seller))}</p>
          <p>Seller: <b>${escapeHtml(seller ? seller.name : "—")}</b>${seller ? ` · ${escapeHtml(seller.location)} · ${escapeHtml(seller.phone || "")}` : ""}</p>
          ${f.description ? `<p class="desc">${escapeHtml(f.description)}</p>` : ""}
          ${f.review_note ? `<p class="review-note">Admin note: “${escapeHtml(f.review_note)}”</p>` : ""}
          <div class="job-buttons">
            ${archived
              ? `<button class="small gold" onclick="restoreSellerFabric('${f.id}')">Restore</button>`
              : `${f.status !== "approved" ? `<button class="small gold" onclick="approveSellerFabric('${f.id}')">✓ Approve</button>` : ""}
                 ${f.status !== "hidden" ? `<button class="small ghost" onclick="hideSellerFabric('${f.id}')">Hide</button>` : ""}
                 <button class="small danger" onclick="archiveSellerFabric('${f.id}')">Archive</button>`}
          </div>
        </div>
      </div>`;
  }).join("");

  const sellerRows = db.suppliers.map(s => {
    const fabrics = (db.fabrics || []).filter(f => f.supplier_id === s.id);
    const active = fabrics.filter(f => !fabricIsArchived(f));
    const orders = sellerOrders(s.id).filter(o => o.status !== "cancelled");
    return `<tr>
      <td><img class="logo tiny" src="${sellerLogoUrl(s)}" alt=""> ${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.location)}</td><td class="nowrap">${escapeHtml(s.phone || "—")}</td><td>${escapeHtml(s.delivery_estimate)}</td>
      <td>${active.filter(f => f.status === "approved").length} live / ${active.length}${fabrics.length !== active.length ? ` · ${fabrics.length - active.length} archived` : ""}</td>
      <td>${active.filter(f => f.status === "pending").length || "—"}</td>
      <td>${orders.length} · ${escapeHtml(totalsText(sumByCurrency(orders, o => o.total, o => o.currency_code || sellerCurrency(s)), sellerCurrency(s)))}</td>
    </tr>`;
  }).join("");

  return `
    ${bizHeader("Seller fabrics", `Approve, hide or archive seller listings. Hiding removes a listing from customers. Archiving removes it from the normal marketplace and inventory while keeping the record available to restore later.`)}
    ${waiting.length ? `<div class="alerts"><span class="alert">${waiting.length} fabric${waiting.length > 1 ? "s" : ""} waiting for approval</span></div>` : ""}
    <div class="card moderation-help">
      <b>Admin moderation</b>
      <span class="hint"><b>Hide</b> for a temporary removal. <b>Archive</b> when you no longer want the listing in the marketplace. Archived items can be restored before being approved again.</span>
    </div>
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
  const fabric = findFabric(fabricId);
  if (!fabric) return;
  fabric.deleted_at = null;
  reviewFabric(fabricId, "approved");
  saveData();
  const shop = findSupplier(fabric.supplier_id);
  toast(isSellerLive(shop) ? `${fabric.name} is live in the Fabric Marketplace.`
    : `${fabric.name} approved. It goes live once you approve ${shop ? shop.name : "the shop"} in Seller applications.`);
  renderAll();
}

function hideSellerFabric(fabricId) {
  const fabric = findFabric(fabricId);
  if (!fabric) return;
  const reason = prompt(`Hide ${fabric.name} from customers? Tell the seller why (optional):`, "");
  if (reason === null) return;
  reviewFabric(fabricId, "hidden", reason.trim());
  saveData();
  toast(`${fabric.name} is hidden from customers.`);
  renderAll();
}

function archiveSellerFabric(fabricId) {
  const fabric = findFabric(fabricId);
  if (!fabric) return;
  const reason = prompt(`Archive ${fabric.name}? It will be removed from the marketplace and normal inventory. Add a reason (optional):`, "");
  if (reason === null) return;
  if (!confirm(`Archive "${fabric.name}"? You can restore it later from the Archived filter.`)) return;
  fabric.status = "hidden";
  fabric.review_note = reason.trim();
  fabric.deleted_at = today();
  fabric.updated_at = today();
  saveData();
  toast(`${fabric.name} archived.`);
  renderAll();
}

function restoreSellerFabric(fabricId) {
  const fabric = findFabric(fabricId);
  if (!fabric) return;
  fabric.deleted_at = null;
  fabric.status = "hidden";
  fabric.review_note = fabric.review_note || "Restored by NebedaHub admin.";
  fabric.updated_at = today();
  saveData();
  sellerFabricFilter = "Hidden";
  toast(`${fabric.name} restored as hidden. Review it, then approve it when ready.`);
  renderAll();
}
