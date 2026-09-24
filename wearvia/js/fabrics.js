// ============================================================
// fabrics.js — browse and choose fabrics
// ============================================================

// Which fabric type is currently selected in the filter ("All" shows everything)
let fabricFilter = "All";

function renderFabrics() {
  // Build the list of fabric types for the filter buttons
  const types = ["All"];
  db.fabrics.forEach(fabric => {
    if (!types.includes(fabric.type)) types.push(fabric.type);
  });

  let filterButtons = "";
  types.forEach(type => {
    filterButtons += `<button class="chip ${type === fabricFilter ? "active" : ""}" onclick="setFabricFilter('${escapeHtml(type)}')">${escapeHtml(type)}</button>`;
  });

  const visible = db.fabrics.filter(f => fabricFilter === "All" || f.type === fabricFilter);

  let cards = "";
  visible.forEach(fabric => {
    cards += `
      <div class="fabric-card">
        <div class="swatch" style="background:${escapeHtml(fabric.color)}"></div>
        <div class="fabric-info">
          <h3>${escapeHtml(fabric.name)}</h3>
          <p>${escapeHtml(fabric.type)} · ${escapeHtml(fabric.supplier)}</p>
          <p><strong>${money(fabric.price)}</strong> per yard</p>
          <p class="${fabric.stock < 5 ? "owed" : ""}">${fabric.stock} yards in stock</p>
          <button onclick="chooseFabric('${fabric.id}')" ${fabric.stock <= 0 ? "disabled" : ""}>
            ${fabric.stock <= 0 ? "Out of stock" : "Choose for an order"}
          </button>
        </div>
      </div>`;
  });

  document.getElementById("fabrics").innerHTML = `
    <h1>Fabric Marketplace</h1>
    <div class="chips">${filterButtons}</div>
    <div class="fabric-grid">${cards}</div>
  `;
}

function setFabricFilter(type) {
  fabricFilter = type;
  renderFabrics();
}

// Jump to the Orders tab with this fabric already picked
function chooseFabric(fabricId) {
  showSection("orders");
  document.getElementById("order-fabric").value = fabricId;
  document.querySelector("#order-form [name=customer]").focus();
}
