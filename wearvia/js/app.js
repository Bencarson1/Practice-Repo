// ============================================================
// app.js — switches between tabs and starts the app
// ============================================================

// Show one section and hide the others
function showSection(sectionId) {
  document.querySelectorAll(".section").forEach(section => {
    section.classList.toggle("active", section.id === sectionId);
  });
  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.section === sectionId);
  });
  window.scrollTo(0, 0);
}

// Redraw every section (called after any data change)
function renderAll() {
  renderHome();
  renderOrders();
  renderMeasurements();
  renderFabrics();
  renderProduction();
  renderPayments();
}

// Start the app once the page has loaded
document.getElementById("shop-name").textContent = SHOP_NAME;

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => showSection(tab.dataset.section));
});

renderAll();
