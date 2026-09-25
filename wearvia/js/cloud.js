// ============================================================
// cloud.js — saving and loading through Supabase
//
// The app has two modes:
//   Live mode  — everyone signs in; data lives in Supabase and is shared
//                by every phone and laptop.
//   Demo mode  — the sample data, kept in this browser only (the "Try the
//                demo" button). Nothing is sent to Supabase.
//
// In live mode the screens still read and change the same `db` object as
// before. After each change, saveData() calls Cloud.save(), which works out
// what changed since the last load and sends only that to Supabase. Then
// everything is loaded again, so what's on screen is what the database
// says. The database's own rules (supabase/setup.sql) decide what each
// person is allowed to change — the browser is never trusted with that.
// ============================================================

const MODE_KEY = "wearvia-mode";
const REFRESH_EVERY_MS = 45000;

const Cloud = (() => {
  const state = {
    live: false,
    client: null,
    me: null,               // what wearvia_bootstrap() says about the signed-in person
    snapshot: null,         // table → Map(id → row as JSON) at the last load
    queue: Promise.resolve(),
    saveScheduled: false,
    renderWanted: false,
    signedUrls: new Map(),  // "sb:style-photos/…" → temporary link
    localPhotos: new Map(), // photos uploaded from this device, shown while they upload
    signing: new Set(),
    teamLogins: null
  };

  // ---- Mode ----

  function wantsDemo() {
    if (/[?&]demo(=1|=true)?(&|$)/.test(location.search)) return true;
    try { return localStorage.getItem(MODE_KEY) === "demo"; } catch (e) { return false; }
  }

  function enterDemo() {
    try { localStorage.setItem(MODE_KEY, "demo"); } catch (e) { /* private browsing */ }
    location.hash = "#/home";
    location.reload();
  }

  function leaveDemo() {
    try { localStorage.removeItem(MODE_KEY); } catch (e) { /* private browsing */ }
    const url = location.pathname + "#/home";
    history.replaceState(null, "", url);
    location.reload();
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // ---- Who is signed in, and what they can open ----

  function isTeam() { return !state.live || !!(state.me && state.me.is_team); }
  function isOwner() { return !state.live || !!(state.me && state.me.is_owner); }

  function canOpen(area) {
    if (!state.live) return true;
    if (area === "business") return isTeam();
    return true;
  }

  function homeRoute() {
    if (!state.live || !state.me) return "home";
    if (state.me.is_team) return "biz/dashboard";
    if (state.me.account_type === "seller") return state.me.supplier_id ? "seller/fabrics" : "seller/profile";
    return "home";
  }

  // ---- Start-up ----

  async function start() {
    if (wantsDemo() || typeof supabase === "undefined" || typeof SUPABASE_URL === "undefined") {
      state.live = false;
      try { localStorage.setItem(MODE_KEY, "demo"); } catch (e) { /* private browsing */ }
      db = loadData();
      return { signedIn: true };
    }
    state.live = true;
    // A link from a sign-up or password email arrives as #access_token=… — that's for Supabase, not a page address
    const authHash = /access_token=|error_description=|type=recovery/.test(location.hash) ? location.hash : "";
    state.client = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    state.client.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setTimeout(() => Auth.show("newPassword"), 0);
      if (event === "SIGNED_OUT") { state.me = null; db = null; Auth.show("signIn"); }
    });
    let session = null;
    try {
      const result = await state.client.auth.getSession();
      session = result.data.session;
    } catch (error) {
      console.warn(error);
    }
    if (authHash) {
      const params = new URLSearchParams(authHash.replace(/^#\/?/, ""));
      history.replaceState(null, "", location.pathname + location.search + "#/home");
      if (params.get("error_description")) Auth.flash(params.get("error_description").replace(/\+/g, " ") + ". Please sign in or ask for a new link.");
      if (params.get("type") === "recovery" && session) return { signedIn: false, recovery: true };
    }
    if (!session) return { signedIn: false };
    return afterSignIn();
  }

  async function afterSignIn() {
    const { data, error } = await state.client.rpc("wearvia_bootstrap");
    if (error) throw new Error(friendly(error));
    state.me = data;
    await load();
    startRefreshing();
    return { signedIn: true };
  }

  // ---- Signing in and out ----

  async function signIn(email, password) {
    const { error } = await state.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(friendly(error));
    return afterSignIn();
  }

  // accountType is "customer" or "seller". Returns { needsConfirmation } when the email must be confirmed first.
  async function signUp(details) {
    const { data, error } = await state.client.auth.signUp({
      email: details.email,
      password: details.password,
      options: {
        data: { full_name: details.name, phone: details.phone || "", account_type: details.accountType },
        emailRedirectTo: location.origin + location.pathname
      }
    });
    if (error) throw new Error(friendly(error));
    if (!data.session) {
      // Supabase hides whether the email was already used; an empty identities list means it was
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error("There's already an account with that email. Sign in instead, or reset your password.");
      }
      return { needsConfirmation: true };
    }
    await afterSignIn();
    return { needsConfirmation: false };
  }

  async function sendPasswordReset(email) {
    const { error } = await state.client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) throw new Error(friendly(error));
  }

  async function setNewPassword(password) {
    const { error } = await state.client.auth.updateUser({ password });
    if (error) throw new Error(friendly(error));
    return afterSignIn();
  }

  async function signOut() {
    await flush();
    await state.client.auth.signOut();
  }

  function friendly(error) {
    const text = (error && (error.message || error.details || error.hint)) || String(error);
    if (/Invalid login credentials/i.test(text)) return "That email and password don't match. Check them and try again.";
    if (/Email not confirmed/i.test(text)) return "Please confirm your email first — open the link we sent you, then sign in.";
    if (/row-level security|permission denied|42501/i.test(text)) return "You don't have permission to do that.";
    if (/Failed to fetch|NetworkError|Load failed/i.test(text)) return "Couldn't reach the server. Check your internet connection and try again.";
    if (/wearvia_bootstrap|function .* does not exist|PGRST202/i.test(text)) return "The database isn't set up yet. Run supabase/setup.sql in Supabase first.";
    return text;
  }

  // ---- Loading ----

  const iso = value => value ? String(value) : null;
  const day = value => value ? String(value).slice(0, 10) : null;
  const num = value => value == null || value === "" ? null : Number(value);

  const STYLE = "style-photos", FABRIC_PHOTOS = "fabric-photos", LOGOS = "seller-logos";

  async function fetchAll(table, order) {
    let query = state.client.from(table).select("*");
    if (order) query = query.order(order, { ascending: true });
    const { data, error } = await query;
    if (error) {
      // A table the setup script hasn't made yet shouldn't stop the whole app
      console.warn(`Couldn't load ${table}:`, error.message);
      if (/does not exist|PGRST205/i.test(error.message || "")) return [];
      throw new Error(friendly(error));
    }
    return data || [];
  }

  async function load() {
    const tables = ["designers", "suppliers", "fabrics", "customers", "measurement_profiles", "orders", "payments",
      "invoices", "deliveries", "fabric_order_lines", "tailors", "wedding_orders", "wedding_order_members",
      "ready_to_wear_items", "ready_to_wear_sales", "reviews"];
    const rows = {};
    const results = await Promise.all(tables.map(t => fetchAll(t, "created_at")));
    tables.forEach((t, i) => { rows[t] = results[i]; });
    const previous = db;
    state.loadedAt = Date.now();
    db = buildDb(rows, previous);
    state.snapshot = snapshotOf(db);
    return db;
  }

  function buildDb(r, previous) {
    const numberOf = new Map(r.orders.map(o => [o.id, o.order_number || "NT-" + o.id.slice(0, 6)]));
    const designerRow = r.designers.slice().sort((a, b) =>
      (/^nebeda/i.test(b.business_name || "") - /^nebeda/i.test(a.business_name || "")))[0];

    const data = {
      designers: [designerRow ? {
        id: designerRow.id, business_name: designerRow.business_name || SHOP_NAME, location: designerRow.location || "",
        rating: num(designerRow.rating) || 5, review_count: 0, speciality_tags: designerRow.speciality_tags || [],
        commission_rate: num(designerRow.commission_rate) || 0, delivery_time: designerRow.delivery_estimate || "7–14 days"
      } : { id: null, business_name: SHOP_NAME, location: "", rating: 5, review_count: 0, speciality_tags: [], commission_rate: 0, delivery_time: "7–14 days" }],

      suppliers: r.suppliers.map(s => ({
        id: s.id, name: s.name || "Seller", location: s.location || "", phone: s.phone || "",
        delivery_estimate: s.delivery_estimate || "1–3 days", rating: num(s.rating), logo: s.logo_url || null,
        owner_user_id: s.owner_user_id || null, created_at: iso(s.created_at)
      })),

      fabrics: r.fabrics.map(f => ({
        id: f.id, supplier_id: f.supplier_id, name: f.name || "Fabric", category: f.category || "Other",
        colour_name: f.colour_name || nearestColourName(f.colour_hex || "#1e2a44"), color: f.colour_hex || colourFamilyHex(f.colour_name),
        price_per_yard: num(f.price_per_yard) || 0, yards_available: num(f.yards_available) || 0,
        min_order_yards: num(f.min_order_yards) || 1, description: f.description || "",
        photos: (f.photos || []).map(p => `sb:${FABRIC_PHOTOS}/${p}`),
        status: f.status || "approved", review_note: f.review_note || "", reviewed_at: day(f.reviewed_at),
        sold_out: !!f.sold_out, deleted_at: day(f.deleted_at), created_at: iso(f.created_at), updated_at: day(f.updated_at)
      })),

      staff: r.tailors.filter(t => t.active !== false).map(t => ({ id: t.id, name: t.name, role: t.role, phone: t.phone || "", designer_id: t.designer_id })),

      customers: r.customers.map(c => ({
        id: c.id, name: c.name || "Customer", email: c.email || "", phone: c.phone || "", notes: c.notes || "",
        auth_user_id: c.auth_user_id || null, created_at: day(c.created_at) || today(),
        measurement_profiles: r.measurement_profiles.filter(p => p.customer_id === c.id).map(p => ({
          id: p.id, label: p.label || thisYear(), chest: num(p.chest), waist: num(p.waist), shoulder: num(p.shoulder),
          sleeve: num(p.sleeve), trouser_length: num(p.trouser_length), neck: num(p.neck), hips: num(p.hip),
          length: num(p.garment_length), updated: day(p.updated_at || p.created_at)
        }))
      })),

      orders: r.orders.map(o => {
        const invoice = r.invoices.find(i => i.order_id === o.id);
        const photos = o.inspiration_photos || [];
        return {
          id: numberOf.get(o.id), _uuid: o.id, customer_id: o.customer_id, designer_id: o.designer_id,
          outfit_type: o.outfit_type || "Custom", colour: o.colour || "#1e2a44", embroidery: o.embroidery || "None",
          sleeve_style: o.sleeve_style || "", neck_style: o.neck_style || "",
          concept_variation: o.concept_variation || 1, concept_image_url: o.concept_image_url || "",
          inspiration: photos.length ? { photos: photos.map(p => `sb:${STYLE}/${p}`), link: o.inspiration_link || "", note: o.inspiration_note || "" } : null,
          measurement_profile_id: o.measurement_profile_id, fabric_id: o.fabric_id, fabric_supplier_id: o.fabric_supplier_id,
          fabric_yards: num(o.fabric_yards) || 0, fabric_cost: num(o.fabric_cost) || 0,
          line_items: o.line_items || (invoice && invoice.line_items) || [
            { label: "Fabric", amount: num(o.fabric_cost) || 0 }, { label: "Tailoring", amount: num(o.tailoring_cost) || 0 },
            { label: "Embroidery", amount: num(o.embroidery_cost) || 0 }, { label: "Delivery", amount: num(o.delivery_cost) || 0 }],
          quote_total: num(o.quote_total) || 0, deposit_amount: num(o.deposit_amount) || 0,
          deposit_paid_at: day(o.deposit_paid_at), balance_paid_at: day(o.balance_paid_at),
          stage: STAGES.some(s => s.key === o.stage) ? o.stage : "tailor_assigned",
          assigned_staff: {
            cutting: o.assigned_cutting || "", sewing: o.assigned_sewing || "", embroidery: o.assigned_embroidery || "",
            finishing: o.assigned_finishing || "", quality_control: o.assigned_quality_control || ""
          },
          review_rating: o.review_rating || null, review_text: o.review_text || "",
          due_date: day(o.due_date) || addDays(14, day(o.created_at) || today()),
          created_at: day(o.created_at) || today(), updated_at: day(o.updated_at) || today()
        };
      }),

      payments: r.payments.map(p => ({
        id: p.id, order_id: numberOf.get(p.order_id), amount: num(p.amount), method: p.method, kind: p.kind,
        status: p.status, date: day(p.paid_on || p.created_at), confirmed_at: day(p.confirmed_at)
      })).filter(p => p.order_id),

      invoices: r.invoices.filter(i => numberOf.has(i.order_id)).map(i => ({
        id: i.invoice_number || "INV-" + String(numberOf.get(i.order_id)).replace(/^\D+/, ""), order_id: numberOf.get(i.order_id),
        line_items: i.line_items || [], total: num(i.total), created_at: day(i.created_at)
      })),

      deliveries: r.deliveries.filter(d => numberOf.has(d.order_id)).map(d => ({
        id: d.id, order_id: numberOf.get(d.order_id), courier: d.courier || "", tracking_number: d.tracking_number || "",
        status: d.status || "Order ready", eta: day(d.eta), updated: day(d.updated_at || d.created_at)
      })),

      fabric_orders: r.fabric_order_lines.map(l => ({
        id: l.id, ref: "FO-" + String(l.order_number || "").replace(/^\D+/, ""), order_id: numberOf.get(l.order_id) || l.order_number,
        seller_id: l.supplier_id, fabric_id: l.fabric_id, fabric_name: l.fabric_name, yards: num(l.yards),
        price_per_yard: num(l.price_per_yard), total: num(l.total), customer_first_name: l.customer_first_name || "",
        deliver_to: l.deliver_to || "", status: l.status, created_at: day(l.created_at), sent_at: day(l.sent_at)
      })),

      wedding_orders: r.wedding_orders.map(w => ({
        id: w.id, designer_id: w.designer_id, event_name: w.event_name || "", event_date: day(w.event_date),
        members: r.wedding_order_members.filter(m => m.wedding_order_id === w.id).map(m => ({
          id: m.id, role: m.role, name: m.name || "", outfits: m.outfits || 1, order_id: numberOf.get(m.order_id) || "", status: m.status || "Not started"
        }))
      })),

      ready_to_wear: r.ready_to_wear_items.filter(i => i.active !== false).map(i => ({
        id: i.id, designer_id: i.designer_id, name: i.name, price: num(i.price), cost: num(i.cost) || 0, stock: i.stock || 0, color: i.colour_hex || "#1e2a44"
      })),
      rtw_sales: r.ready_to_wear_sales.map(s => ({
        id: s.id, item_id: s.item_id, customer_id: s.customer_id, price: num(s.price), cost: num(s.cost) || 0,
        date: day(s.sold_on || s.created_at), status: s.status
      })),

      reviews: r.reviews.map(v => ({
        id: v.id, order_id: numberOf.get(v.order_id) || null, designer_id: v.designer_id, customer_id: v.customer_id,
        rating: v.rating, review_text: v.review_text || "", created_at: day(v.created_at)
      })),

      session: {
        customerId: state.me && state.me.customer_id || (previous && previous.session && previous.session.customerId) || null,
        sellerId: (previous && previous.session && previous.session.sellerId) || (state.me && state.me.supplier_id) || null
      },
      draft: previous ? previous.draft : loadDraft(),
      counters: { order: 0, payment: 0, invoice: 0 },
      sample_sellers_added: true,
      version: 4
    };
    // Someone who signed up as a seller but hasn't opened their shop yet
    if (data.session.sellerId && !data.suppliers.some(s => s.id === data.session.sellerId)) data.session.sellerId = null;
    if (!data.session.sellerId && state.me) {
      const mine = data.suppliers.find(s => s.owner_user_id === state.me.user_id);
      if (mine) data.session.sellerId = mine.id;
    }
    return data;
  }

  // ---- The draft order (kept on this device until it's paid for) ----

  function draftKey() { return "wearvia-draft-" + (state.me ? state.me.user_id : "anon"); }

  function loadDraft() {
    try { return upgradeDraftToYards(JSON.parse(localStorage.getItem(draftKey()) || "null")); } catch (e) { return null; }
  }

  function saveDraft() {
    try {
      if (db && db.draft) localStorage.setItem(draftKey(), JSON.stringify(db.draft));
      else localStorage.removeItem(draftKey());
    } catch (e) { /* storage full or private browsing: the draft just isn't kept */ }
  }

  // ---- Saving: work out what changed and send it ----

  const orderUuid = number => {
    const order = db.orders.find(o => o.id === number);
    return order ? order._uuid : null;
  };
  const photoPath = (ref, bucket) => String(ref).startsWith(`sb:${bucket}/`) ? String(ref).slice(bucket.length + 4) : null;

  // Each table: the rows it should contain, built from `db`. Only columns the app may change are listed.
  const TABLES = [
    { table: "suppliers", rows: d => d.suppliers.map(s => ({
        id: s.id, name: s.name, location: s.location, phone: s.phone, delivery_estimate: s.delivery_estimate,
        logo_url: s.logo || null, owner_user_id: s.owner_user_id || null })) },
    { table: "fabrics", rows: d => d.fabrics.map(f => ({
        id: f.id, supplier_id: f.supplier_id, name: f.name, category: f.category, colour_name: f.colour_name || null,
        colour_hex: f.color || null, price_per_yard: f.price_per_yard, yards_available: f.yards_available,
        min_order_yards: f.min_order_yards, description: f.description || "",
        photos: (f.photos || []).map(ref => photoPath(ref, FABRIC_PHOTOS)).filter(Boolean),
        status: f.status, review_note: f.review_note || "", sold_out: !!f.sold_out,
        deleted_at: f.deleted_at ? new Date(f.deleted_at + "T12:00:00Z").toISOString() : null })) },
    { table: "customers", rows: d => d.customers.map(c => ({ id: c.id, name: c.name, email: c.email || null, phone: c.phone || null, notes: c.notes || "" })) },
    { table: "measurement_profiles", rows: d => d.customers.flatMap(c => c.measurement_profiles.map(p => ({
        id: p.id, customer_id: c.id, label: p.label, chest: p.chest, waist: p.waist, shoulder: p.shoulder, sleeve: p.sleeve,
        trouser_length: p.trouser_length, neck: p.neck, hip: p.hips, garment_length: p.length }))) },
    { table: "tailors", rows: d => d.staff.map(s => ({ id: s.id, designer_id: s.designer_id || d.designers[0].id, name: s.name, role: s.role, phone: s.phone || "" })) },
    { table: "wedding_orders", rows: d => d.wedding_orders.map(w => ({ id: w.id, designer_id: w.designer_id || d.designers[0].id, event_name: w.event_name, event_date: w.event_date })) },
    { table: "wedding_order_members", rows: d => d.wedding_orders.flatMap(w => w.members.map(m => ({
        id: m.id, wedding_order_id: w.id, role: m.role, name: m.name || "", outfits: Number(m.outfits) || 1,
        order_id: m.order_id ? orderUuid(m.order_id) : null, status: m.status || "Not started" }))) },
    { table: "orders", rows: d => d.orders.filter(o => o._uuid).map(o => ({
        id: o._uuid, stage: o.stage, due_date: o.due_date,
        assigned_cutting: o.assigned_staff.cutting || null, assigned_sewing: o.assigned_staff.sewing || null,
        assigned_embroidery: o.assigned_staff.embroidery || null, assigned_finishing: o.assigned_staff.finishing || null,
        assigned_quality_control: o.assigned_staff.quality_control || null })) },
    { table: "payments", rows: d => d.payments.map(p => ({
        id: p.id, order_id: orderUuid(p.order_id), amount: p.amount, method: p.method, kind: p.kind,
        status: p.status || "confirmed", paid_on: p.date })) },
    { table: "deliveries", rows: d => d.deliveries.map(x => ({
        id: x.id, order_id: orderUuid(x.order_id), courier: x.courier, tracking_number: x.tracking_number, status: x.status, eta: x.eta })) },
    { table: "reviews", rows: d => (d.reviews || []).map(v => ({
        id: v.id, order_id: orderUuid(v.order_id), designer_id: v.designer_id, customer_id: v.customer_id, rating: v.rating, review_text: v.review_text })) },
    { table: "fabric_order_lines", rows: d => d.fabric_orders.map(l => ({ id: l.id, status: l.status })) },
    { table: "ready_to_wear_items", rows: d => d.ready_to_wear.map(i => ({
        id: i.id, designer_id: i.designer_id || d.designers[0].id, name: i.name, price: i.price, cost: i.cost, stock: i.stock, colour_hex: i.color })) },
    { table: "ready_to_wear_sales", rows: d => d.rtw_sales.map(s => ({
        id: s.id, item_id: s.item_id, customer_id: s.customer_id || null, price: s.price, cost: s.cost,
        status: s.status || "confirmed", sold_on: s.date })) }
  ];

  // What someone who isn't on the Nebeda Threads team may send. Everything
  // else they change on screen is only a preview and is replaced on reload.
  const CUSTOMER_WRITES = {
    customers: ["insert", "update"], measurement_profiles: ["insert", "update", "delete"],
    payments: ["insert"], reviews: ["insert"], ready_to_wear_sales: ["insert"],
    suppliers: ["insert", "update"], fabrics: ["insert", "update"], fabric_order_lines: ["update"]
  };
  const allowed = (table, op) => isTeam() || (CUSTOMER_WRITES[table] || []).includes(op);

  function snapshotOf(data) {
    const snap = {};
    TABLES.forEach(spec => {
      const map = new Map();
      spec.rows(data).forEach(row => map.set(row.id, JSON.stringify(row)));
      snap[spec.table] = map;
    });
    return snap;
  }

  function changesSince(snap) {
    const changes = [];
    TABLES.forEach(spec => {
      const before = snap[spec.table];
      const now = new Map();
      spec.rows(db).forEach(row => now.set(row.id, row));
      now.forEach((row, id) => {
        if (!before.has(id)) {
          changes.push({ table: spec.table, op: "insert", id, row });
        } else if (before.get(id) !== JSON.stringify(row)) {
          const old = JSON.parse(before.get(id));
          const changed = {};
          Object.keys(row).forEach(k => { if (JSON.stringify(row[k]) !== JSON.stringify(old[k])) changed[k] = row[k]; });
          changes.push({ table: spec.table, op: "update", id, row: changed });
        }
      });
      before.forEach((json, id) => { if (!now.has(id)) changes.push({ table: spec.table, op: "delete", id }); });
    });
    // Delete children before parents
    const order = TABLES.map(t => t.table);
    const deletes = changes.filter(c => c.op === "delete").sort((a, b) => order.indexOf(b.table) - order.indexOf(a.table));
    return changes.filter(c => c.op !== "delete").concat(deletes);
  }

  async function push() {
    if (!state.live || !state.snapshot || !db) return { pushed: 0, errors: [] };
    const changes = changesSince(state.snapshot);
    const errors = [];
    let pushed = 0, skipped = 0;
    for (const change of changes) {
      if (!allowed(change.table, change.op)) { skipped += 1; continue; }
      const from = state.client.from(change.table);
      let result;
      if (change.op === "insert") result = await from.insert(change.row);
      else if (change.op === "update") result = await from.update(change.row).eq("id", change.id).select("id");
      else result = await from.delete().eq("id", change.id).select("id");
      if (result.error) {
        errors.push(result.error);
      } else if (change.op !== "insert" && result.data && result.data.length === 0) {
        errors.push({ message: "permission denied" });
      } else {
        pushed += 1;
      }
    }
    return { pushed, skipped, errors };
  }

  function run(task) {
    const next = state.queue.then(task, task);
    state.queue = next.catch(() => {});
    return next;
  }

  // Called by saveData() after every change
  function save() {
    if (!state.live) return;
    saveDraft();
    if (state.saveScheduled) return;
    state.saveScheduled = true;
    setTimeout(() => {
      state.saveScheduled = false;
      run(syncNow);
    }, 0);
  }

  async function syncNow() {
    const result = await push();
    if (result.errors.length) {
      console.warn("Supabase refused some changes:", result.errors);
      toast("Couldn't save: " + friendly(result.errors[0]));
    }
    if (result.pushed || result.skipped || result.errors.length) await reloadAndRedraw();
  }

  function flush() {
    return run(syncNow);
  }

  // Moving between pages checks for other people's changes, at most every few seconds
  function refreshIfStale() {
    if (state.live && state.me && Date.now() - (state.loadedAt || 0) > 4000) refresh();
  }

  function refresh() {
    if (!state.live || !state.me) return Promise.resolve();
    state.loadedAt = Date.now();
    return run(async () => {
      await push();
      await reloadAndRedraw();
    });
  }

  function isTyping() {
    const el = document.activeElement;
    return !!(el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.closest("main"));
  }

  async function reloadAndRedraw() {
    const before = fingerprint();
    try {
      await load();
    } catch (error) {
      console.warn(error);
      return;
    }
    if (fingerprint() !== before) requestRender();
  }

  function fingerprint() {
    if (!db) return "";
    const copy = Object.assign({}, db, { session: null, draft: null });
    return JSON.stringify(copy);
  }

  function requestRender() {
    if (isTyping()) { state.renderWanted = true; return; }
    state.renderWanted = false;
    renderAll();
  }

  function startRefreshing() {
    if (state.refreshing) return;
    state.refreshing = true;
    setInterval(() => {
      if (document.visibilityState === "visible" && state.me) {
        if (state.renderWanted && !isTyping()) requestRender();
        refresh();
      }
    }, REFRESH_EVERY_MS);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
  }

  // ---- Placing and deleting orders (done straight away, not through save()) ----

  function placeOrder(details) {
    return run(async () => {
      await push();                     // a new walk-in customer or measurements must exist first
      const lines = details.quote.lines;
      const id = newId();
      const insp = details.inspiration;
      const row = {
        id, customer_id: details.customerId, designer_id: designer().id,
        outfit_type: details.outfit, colour: details.colour, embroidery: details.embroidery,
        sleeve_style: details.sleeve, neck_style: details.neck, concept_variation: details.variation || 1,
        measurement_profile_id: details.profileId || null,
        fabric_id: details.fabric.id, fabric_yards: details.yards, fabric_cost: details.quote.fabricCost,
        tailoring_cost: lines[1].amount, embroidery_cost: lines[2].amount, delivery_cost: lines[3].amount,
        quote_total: details.quote.total, deposit_amount: details.deposit, line_items: lines,
        inspiration_photos: insp ? insp.photos.map(ref => photoPath(ref, STYLE)).filter(Boolean) : [],
        inspiration_link: insp ? insp.link || null : null, inspiration_note: insp ? insp.note || null : null,
        due_date: details.dueDate || addDays(14)
      };
      const created = await state.client.from("orders").insert(row).select("id, order_number").single();
      if (created.error) throw new Error(friendly(created.error));
      if (details.deposit > 0) {
        const paid = await state.client.from("payments").insert({
          id: newId(), order_id: id, amount: details.deposit, method: details.method, kind: "Deposit",
          status: details.confirmed ? "confirmed" : "awaiting_confirmation", paid_on: today()
        });
        if (paid.error) toast("The order was placed, but the deposit couldn't be recorded: " + friendly(paid.error));
      }
      await load();
      return db.orders.find(o => o._uuid === id);
    });
  }

  function deleteOrder(order) {
    return run(async () => {
      await push();
      const { data, error } = await state.client.from("orders").delete().eq("id", order._uuid).select("id");
      if (error) throw new Error(friendly(error));
      if (!data.length) throw new Error("You don't have permission to delete that order.");
      await load();
    });
  }

  // ---- Photos in Supabase Storage ----
  // Uploads go in a folder named after the signed-in user, as the Storage rules require.

  function dataUrlToBlob(dataUrl) {
    const [head, body] = dataUrl.split(",");
    const type = (head.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
    const bytes = atob(body);
    const array = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
    return new Blob([array], { type });
  }

  function publicUrl(bucket, path) {
    return state.client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  async function uploadPhoto(dataUrl, folder) {
    const bucket = folder === "style" ? STYLE : folder === "logo" ? LOGOS : FABRIC_PHOTOS;
    const path = `${state.me.user_id}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await state.client.storage.from(bucket).upload(path, dataUrlToBlob(dataUrl), { contentType: "image/jpeg", upsert: false });
    if (error) throw new Error(friendly(error));
    if (bucket === LOGOS) return publicUrl(bucket, path);
    const ref = `sb:${bucket}/${path}`;
    state.localPhotos.set(ref, dataUrl);
    return ref;
  }

  function splitRef(ref) {
    const text = String(ref || "");
    if (text.startsWith("sb:")) {
      const rest = text.slice(3);
      const cut = rest.indexOf("/");
      return { bucket: rest.slice(0, cut), path: rest.slice(cut + 1) };
    }
    const marker = "/storage/v1/object/public/";
    if (text.startsWith(SUPABASE_URL) && text.includes(marker)) {
      const rest = text.slice(text.indexOf(marker) + marker.length);
      const cut = rest.indexOf("/");
      return { bucket: rest.slice(0, cut), path: rest.slice(cut + 1) };
    }
    return null;
  }

  function removePhoto(ref) {
    const where = splitRef(ref);
    if (!where || !state.me || !where.path.startsWith(state.me.user_id + "/")) return;
    state.localPhotos.delete(ref);
    state.client.storage.from(where.bucket).remove([where.path]).catch(() => {});
  }

  function photoUrl(ref) {
    const where = splitRef(ref);
    if (!where) return "";
    if (where.bucket !== STYLE) return publicUrl(where.bucket, where.path);
    if (state.signedUrls.has(ref)) return state.signedUrls.get(ref);
    signSoon(ref);
    return state.localPhotos.get(ref) || "";
  }

  // Private style photos need a short-lived link; ask for them in one batch
  let signTimer = null;
  function signSoon(ref) {
    if (state.signing.has(ref)) return;
    state.signing.add(ref);
    clearTimeout(signTimer);
    signTimer = setTimeout(async () => {
      const refs = Array.from(state.signing).filter(r => !state.signedUrls.has(r));
      if (!refs.length) return;
      const { data, error } = await state.client.storage.from(STYLE).createSignedUrls(refs.map(r => splitRef(r).path), 60 * 60);
      if (error) { console.warn(error); refs.forEach(r => state.signing.delete(r)); return; }
      data.forEach((item, i) => { if (item.signedUrl) state.signedUrls.set(refs[i], item.signedUrl); });
      if (refs.some(r => !state.localPhotos.has(r))) requestRender();
    }, 30);
  }

  // ---- Team logins (owner only) ----

  async function loadTeamLogins() {
    const { data, error } = await state.client.rpc("wearvia_team_logins");
    if (error) throw new Error(friendly(error));
    state.teamLogins = data || [];
    return state.teamLogins;
  }

  async function addTeamLogin(email, jobRole) {
    const { data, error } = await state.client.rpc("wearvia_add_team_member", { p_email: email, p_job_role: jobRole });
    if (error) throw new Error(friendly(error));
    await loadTeamLogins();
    return data;
  }

  async function removeTeamLogin(kind, id) {
    const table = kind === "invite" ? "designer_staff_invites" : "designer_staff";
    const { data, error } = await state.client.from(table).delete().eq("id", id).select("id");
    if (error) throw new Error(friendly(error));
    if (!data.length) throw new Error("You don't have permission to remove that login.");
    await loadTeamLogins();
  }

  return {
    get live() { return state.live; },
    get me() { return state.me; },
    get teamLogins() { return state.teamLogins; },
    start, afterSignIn, signIn, signUp, signOut, sendPasswordReset, setNewPassword,
    enterDemo, leaveDemo, newId, isTeam, isOwner, canOpen, homeRoute,
    save, flush, refresh, refreshIfStale, placeOrder, deleteOrder,
    uploadPhoto, removePhoto, photoUrl,
    loadTeamLogins, addTeamLogin, removeTeamLogin
  };
})();
