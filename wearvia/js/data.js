// ============================================================
// data.js — settings, sample data, and saving/loading
// ============================================================

// ---- Settings you can change ----
const SHOP_NAME = "Nebeda Threads";
const CURRENCY = "£";
const STAGES = ["cutting", "sewing", "finishing", "ready"];
const STORAGE_KEY = "wearvia-data";

// ---- Sample data so the app has something to show ----
const SAMPLE_DATA = {
  customers: [
    { id: "C1", name: "Adaeze Okafor", phone: "555-0101" },
    { id: "C2", name: "Tunde Balogun", phone: "555-0102" },
    { id: "C3", name: "Grace Mensah", phone: "555-0103" },
    { id: "C4", name: "Ifeanyi Obi", phone: "555-0104" }
  ],

  // Measurements are in inches, one record per customer
  measurements: [
    { customerId: "C1", neck: 13.5, chest: 36, waist: 29, hips: 40, shoulder: 15, sleeve: 23, length: 42, inseam: 30, notes: "Prefers a relaxed fit at the waist", updated: "2026-09-10" },
    { customerId: "C2", neck: 16, chest: 42, waist: 36, hips: 41, shoulder: 18.5, sleeve: 25.5, length: 30, inseam: 32, notes: "Slim-fit trousers", updated: "2026-09-12" },
    { customerId: "C3", neck: 15.5, chest: 44, waist: 38, hips: 43, shoulder: 19, sleeve: 26, length: 48, inseam: 31, notes: "", updated: "2026-09-05" },
    { customerId: "C4", neck: 15, chest: 40, waist: 34, hips: 39, shoulder: 17.5, sleeve: 25, length: 29, inseam: 32, notes: "Short sleeves on shirts", updated: "2026-09-15" }
  ],

  // Price is per yard in pounds (£); stock is in yards
  fabrics: [
    { id: "F1", name: "Sunburst Ankara", type: "Cotton", color: "#e8871e", price: 9, stock: 40, supplier: "Lagos Prints Co." },
    { id: "F2", name: "Midnight Navy Wool", type: "Wool", color: "#1f2a44", price: 40, stock: 25, supplier: "Highland Mills" },
    { id: "F3", name: "Royal Gold Aso Oke", type: "Handwoven", color: "#c9a227", price: 45, stock: 18, supplier: "Iseyin Weavers" },
    { id: "F4", name: "Classic White Linen", type: "Linen", color: "#f4f1ea", price: 16, stock: 60, supplier: "Riverside Linens" },
    { id: "F5", name: "Emerald Silk", type: "Silk", color: "#1d7a5a", price: 35, stock: 12, supplier: "Silk Road Traders" },
    { id: "F6", name: "Champagne Lace", type: "Lace", color: "#e9d8b4", price: 28, stock: 20, supplier: "Lace House" }
  ],

  // "price" is what the customer pays for the finished, made-to-measure garment
  orders: [
    { id: "NT-1001", customerId: "C1", item: "Ankara wrap dress", fabricId: "F1", yards: 4, price: 180, dueDate: "2026-10-02", stage: "sewing", created: "2026-09-10" },
    { id: "NT-1002", customerId: "C2", item: "Two-piece suit", fabricId: "F2", yards: 5, price: 850, dueDate: "2026-10-10", stage: "cutting", created: "2026-09-12" },
    { id: "NT-1003", customerId: "C3", item: "Agbada set", fabricId: "F3", yards: 8, price: 650, dueDate: "2026-09-30", stage: "finishing", created: "2026-09-05" },
    { id: "NT-1004", customerId: "C4", item: "Linen shirt", fabricId: "F4", yards: 2.5, price: 120, dueDate: "2026-09-26", stage: "ready", created: "2026-09-15" },
    { id: "NT-1005", customerId: "C1", item: "Silk blouse", fabricId: "F5", yards: 2, price: 220, dueDate: "2026-10-15", stage: "cutting", created: "2026-09-20" }
  ],

  payments: [
    { id: "P1", orderId: "NT-1001", amount: 90, method: "Cash", date: "2026-09-10" },
    { id: "P2", orderId: "NT-1002", amount: 425, method: "Bank transfer", date: "2026-09-12" },
    { id: "P3", orderId: "NT-1003", amount: 650, method: "Bank transfer", date: "2026-09-05" },
    { id: "P4", orderId: "NT-1004", amount: 60, method: "Card", date: "2026-09-15" }
  ]
};

// ---- Load and save (uses the browser's localStorage) ----

// "db" holds all the app's data while it runs
let db = loadData();

function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.warn("Could not load saved data, using sample data.", error);
  }
  // Make a copy so the original sample data is never changed
  return JSON.parse(JSON.stringify(SAMPLE_DATA));
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (error) {
    console.warn("Could not save data.", error);
  }
}

function resetSampleData() {
  if (confirm("This will erase your changes and restore the sample data. Continue?")) {
    db = JSON.parse(JSON.stringify(SAMPLE_DATA));
    saveData();
    renderAll();
  }
}

// ---- Small helper functions used by every section ----

function findCustomer(id) {
  return db.customers.find(c => c.id === id);
}

function findFabric(id) {
  return db.fabrics.find(f => f.id === id);
}

function findOrder(id) {
  return db.orders.find(o => o.id === id);
}

// Finds a customer by name, or creates a new one if they don't exist yet
function findOrCreateCustomer(name, phone) {
  let customer = db.customers.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (!customer) {
    customer = { id: "C" + (db.customers.length + 1), name: name, phone: phone || "" };
    // Make sure the id is unique
    while (findCustomer(customer.id)) {
      customer.id = "C" + (Number(customer.id.slice(1)) + 1);
    }
    db.customers.push(customer);
  } else if (phone) {
    customer.phone = phone;
  }
  return customer;
}

// Total paid so far for an order
function amountPaid(orderId) {
  return db.payments
    .filter(p => p.orderId === orderId)
    .reduce((total, p) => total + p.amount, 0);
}

// How much the customer still owes on an order
function balanceOwed(order) {
  return order.price - amountPaid(order.id);
}

function money(amount) {
  return CURRENCY + amount.toFixed(2);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Makes text safe to put inside HTML (stops names like "<b>" breaking the page)
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
