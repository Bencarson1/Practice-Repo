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

// Each app keeps its own demo switch and its own sign-in, so the same email
// can be signed in to NebedaHub and NebedaHub Business separately. The
// customer app keeps Supabase's usual key, so customers stay signed in.
const MODE_KEY = APP_KIND === "customer" ? "wearvia-mode" : `wearvia-mode-${APP_KIND}`;
const AUTH_STORAGE_KEY = APP_KIND === "customer" ? undefined : `nebedahub-${APP_KIND}-auth`;
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
    location.hash = "#/" + APP.home;
    location.reload();
  }

  function leaveDemo() {
    try { localStorage.removeItem(MODE_KEY); } catch (e) { /* private browsing */ }
    const url = location.pathname + "#/" + APP.home;
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

  // Where this person starts in this app
  function homeRoute() {
    if (!state.live || !state.me) return APP.home;
    const me = state.me;
    if (APP_KIND === "business") {
      if (!me.is_team) return "welcome";
      return me.designer_id && me.designers && me.designers.length && me.designers[0].admin_status !== "approved" ? "profile" : "dashboard";
    }
    if (APP_KIND === "seller") return me.supplier_id ? "fabrics" : "welcome";
    return APP.home;
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
      auth: Object.assign({ persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }, AUTH_STORAGE_KEY ? { storageKey: AUTH_STORAGE_KEY } : {})
    });
    state.client.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setTimeout(() => Auth.show("newPassword"), 0);
      if (event === "SIGNED_OUT") { state.me = null; db = null; state.snapshot = null; Auth.show("signIn"); }
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
      history.replaceState(null, "", location.pathname + location.search + "#/" + APP.home);
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
        data: { full_name: details.name, phone: details.phone || "", account_type: details.accountType, measurement_unit: details.unit || "",
                business_name: details.businessName || "", country_code: details.country || "", city: details.city || "",
                tailor_terms: details.accountType === "designer" && details.acceptTerms ? TAILOR_TERMS_VERSION : "" },
        emailRedirectTo: location.origin + location.pathname
      }
    });
    if (error) throw new Error(friendly(error));
    if (!data.session) {
      // Supabase hides whether the email was already used; an empty identities list means it was
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error(`There's already a ${APP_NAME} account with that email (perhaps from another ${APP_NAME} app). Sign in with it here instead, or reset your password.`);
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
    return newName(text);
  }

  // ---- Browsing tailors without an account ----
  // Anyone can find tailors and open their pages. Everything else needs signing in.

  const GUEST_SCREENS = ["tailors", "tailor"];

  function isGuest() { return state.live && !state.me; }

  async function startGuest() {
    const lists = await loadPublicLists().catch(() => ({ countries: [], specialities: [] }));
    const empty = {};
    ["suppliers", "fabrics", "customers", "measurement_profiles", "orders", "payments", "invoices", "deliveries", "fabric_order_lines",
     "tailors", "wedding_orders", "wedding_order_members", "ready_to_wear_items", "ready_to_wear_sales", "reviews", "price_list",
     "order_messages", "order_chat_reads", "designers", "my_designers", "designer_portfolio_items", "designer_customer_notes"].forEach(t => { empty[t] = []; });
    empty.countries = lists.countries;
    empty.specialities = lists.specialities;
    empty.currencies = lists.currencies;
    empty.exchange_rates = lists.exchange_rates;
    db = buildDb(empty, null);
    return db;
  }

  // ---- Loading ----

  const iso = value => value ? String(value) : null;
  // A date column stays as it is; a timestamp becomes the date in this device's time zone
  const day = value => !value ? null : /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : localDay(value);
  const num = value => value == null || value === "" ? null : Number(value);

  const STYLE = "style-photos", FABRIC_PHOTOS = "fabric-photos", LOGOS = "seller-logos", CHAT = "chat-photos", DESIGNER_PHOTOS = "designer-photos";
  // The tailor columns everyone may read. The exact address, postcode and map
  // position are private: owners read their own through wearvia_my_designers().
  // (public_address is always empty now: the address is only shared with a
  // customer once their deposit is confirmed — wearvia_delivery_details.)
  const DESIGNER_PUBLIC = "id, business_name, slug, location, rating, review_count, speciality_tags, owner_user_id, admin_status, "
    + "profile_image_url, description, starting_price, delivery_estimate, country_code, city, postcode_area, public_address, "
    + "public_latitude, public_longitude, show_exact_address, delivery_available, custom_orders, created_at, updated_at, currency_code";
  // Phone and email aren't readable from the table (supabase/no-leakage.sql):
  // wearvia_customer_contacts() gives your own, and your walk-in customers'
  const CUSTOMER_COLUMNS = "id, auth_user_id, name, created_at, added_by_designer_id, country_code, currency_code, measurement_unit";
  const PRIVATE_BUCKETS = [STYLE, CHAT];

  async function fetchAll(table, order, columns, filter) {
    let query = state.client.from(table).select(columns || "*");
    if (filter) query = filter(query);
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

  async function rpcRows(name, args) {
    const { data, error } = await state.client.rpc(name, args || {});
    if (error) {
      console.warn(`Couldn't load ${name}:`, error.message);
      if (/does not exist|PGRST202/i.test(error.message || "")) return [];
      throw new Error(friendly(error));
    }
    return data || [];
  }

  async function load() {
    const tables = ["suppliers", "fabrics", "measurement_profiles", "orders", "payments",
      "invoices", "deliveries", "fabric_order_lines", "tailors", "wedding_orders", "wedding_order_members",
      "ready_to_wear_sales", "order_messages", "order_chat_reads", "countries", "specialities", "designer_customer_notes",
      "currencies", "exchange_rates"];
    const sortBy = { order_chat_reads: "last_read_at", countries: "sort_order", specialities: "sort_order", designer_customer_notes: "updated_at",
      currencies: "sort_order", exchange_rates: "currency_code" };
    const rows = {};
    const results = await Promise.all(tables.map(t => fetchAll(t, sortBy[t] || "created_at"))
      .concat([fetchAll("customers", "created_at", CUSTOMER_COLUMNS),
               state.me && state.me.is_team ? rpcRows("wearvia_my_designers") : Promise.resolve([]),
               rpcRows("wearvia_customer_contacts"),
               rpcRows("wearvia_delivery_details"),
               state.me && state.me.is_admin ? fetchAll("hidden_contact_details", "created_at", "source, source_id, original", q => q.eq("source", "chat")) : Promise.resolve([])]));
    tables.forEach((t, i) => { rows[t] = results[i]; });
    rows.customers = results[tables.length];
    rows.my_designers = results[tables.length + 1];
    const contacts = new Map(results[tables.length + 2].map(c => [c.id, c]));
    rows.customers.forEach(c => Object.assign(c, { email: (contacts.get(c.id) || {}).email || null, phone: (contacts.get(c.id) || {}).phone || null }));
    rows.delivery_details = results[tables.length + 3];
    rows.hidden_originals = results[tables.length + 4];

    // Only the tailors this person needs: their own, their orders' tailors,
    // Nebeda Threads, and the one they're ordering from now
    const ids = new Set(rows.my_designers.map(d => d.id).concat(rows.orders.map(o => o.designer_id)));
    (state.me && state.me.designers || []).forEach(d => ids.add(d.id));
    if (state.me && state.me.main_designer_id) ids.add(state.me.main_designer_id);
    const draftTailor = (db && db.draft && db.draft.designerId) || (loadDraft() || {}).designerId;
    if (draftTailor) ids.add(draftTailor);
    const list = Array.from(ids).filter(Boolean);
    const inList = q => q.in(list.length ? "designer_id" : "id", list.length ? list : ["00000000-0000-0000-0000-000000000000"]);
    const [designers, prices, items, reviews, portfolio] = await Promise.all([
      fetchAll("designers", "created_at", DESIGNER_PUBLIC, q => q.in("id", list.length ? list : ["00000000-0000-0000-0000-000000000000"])),
      fetchAll("price_list", "sort_order", null, inList),
      fetchAll("ready_to_wear_items", "created_at", null, inList),
      fetchAll("reviews", "created_at", null, inList),
      fetchAll("designer_portfolio_items", "sort_order", null, inList)
    ]);
    Object.assign(rows, { designers, price_list: prices, ready_to_wear_items: items, reviews, designer_portfolio_items: portfolio });

    const previous = db;
    state.loadedAt = Date.now();
    db = buildDb(rows, previous);
    usePricesOf(contextDesignerId());   // quotes use the prices the database charges
    state.snapshot = snapshotOf(db);
    return db;
  }

  // A tailor record from the database (public columns, plus the private ones for the owner)
  function designerFrom(row, full, portfolio) {
    const d = Object.assign({}, row, full || {});
    return {
      id: d.id, business_name: d.business_name || "Tailor", slug: d.slug || "", location: d.location || "",
      rating: num(d.rating), review_count: d.review_count || 0, speciality_tags: d.speciality_tags || [],
      commission_rate: num(d.commission_rate) || 0, delivery_time: d.delivery_estimate || "7–14 days",
      profile_image: d.profile_image_url || null, description: d.description || "", starting_price: num(d.starting_price),
      country_code: d.country_code || null, city: d.city || "", postcode_area: d.postcode_area || null,
      public_address: d.public_address || null, public_latitude: num(d.public_latitude), public_longitude: num(d.public_longitude),
      show_exact_address: !!d.show_exact_address, delivery_available: !!d.delivery_available, custom_orders: d.custom_orders !== false,
      admin_status: d.admin_status || (d.approved ? "approved" : "pending"), admin_note: d.admin_note || "",
      owner_user_id: d.owner_user_id || null, created_at: iso(d.created_at), updated_at: iso(d.updated_at),
      currency_code: d.currency_code || undefined, from_price: num(d.from_price),
      // Private: only filled in for the owner, their team and the admin
      postcode: full ? full.postcode || "" : undefined, address_line: full ? full.address_line || "" : undefined,
      latitude: full ? num(full.latitude) : undefined, longitude: full ? num(full.longitude) : undefined,
      phone: full ? full.phone || "" : undefined, is_mine: !!full,
      tailor_terms_accepted_at: full ? iso(full.tailor_terms_accepted_at) : undefined,
      portfolio: (portfolio || []).filter(p => p.designer_id === d.id).map(p => ({ id: p.id, image: p.image_url, title: p.title || p.caption || "" }))
    };
  }

  function buildDb(r, previous) {
    const numberOf = new Map(r.orders.map(o => [o.id, o.order_number || "NT-" + o.id.slice(0, 6)]));
    const full = new Map(r.my_designers.map(d => [d.id, d]));
    const publicRows = new Map(r.designers.map(d => [d.id, d]));
    r.my_designers.forEach(d => { if (!publicRows.has(d.id)) publicRows.set(d.id, d); });

    const data = {
      designers: Array.from(publicRows.values()).map(d => designerFrom(d, full.get(d.id), r.designer_portfolio_items)),
      main_designer_id: (state.me && state.me.main_designer_id) || null,
      countries: r.countries.map(c => ({ code: c.code, name: c.name, slug: c.slug, flag: c.flag, uses_miles: !!c.uses_miles, sort_order: c.sort_order,
        currency_code: c.currency_code || null, phone_code: c.phone_code || "", fabric_unit: c.fabric_unit || null })),
      // Empty until supabase/worldwide.sql has run (worldwide.js then uses its own list)
      currencies: (r.currencies || []).map(c => ({ code: c.code, name: c.name, symbol: c.symbol, decimals: Number(c.decimals), trim_zeros: !!c.trim_zeros, sort_order: c.sort_order })),
      exchange_rates: (r.exchange_rates || []).map(x => ({ currency_code: x.currency_code, units_per_usd: num(x.units_per_usd), rate_date: x.rate_date, source: x.source || "" })),
      specialities: r.specialities.map(x => ({ id: x.id, name: x.name, sort_order: x.sort_order, active: x.active !== false })),
      customer_notes: r.designer_customer_notes.map(n => ({ designer_id: n.designer_id, customer_id: n.customer_id, notes: n.notes || "" })),

      suppliers: r.suppliers.map(s => ({
        id: s.id, name: s.name || "Seller", location: s.location || "", phone: s.phone || "",
        delivery_estimate: s.delivery_estimate || "1–3 days", rating: num(s.rating), logo: s.logo_url || null,
        owner_user_id: s.owner_user_id || null, created_at: iso(s.created_at),
        country_code: s.country_code || null, currency_code: s.currency_code || "GBP"
      })),

      fabrics: r.fabrics.map(f => ({
        id: f.id, supplier_id: f.supplier_id, name: f.name || "Fabric", category: f.category || "Other",
        colour_name: f.colour_name || nearestColourName(f.colour_hex || "#1e2a44"), color: f.colour_hex || colourFamilyHex(f.colour_name),
        price_per_yard: num(f.price_per_yard) || 0, yards_available: num(f.yards_available) || 0, currency_code: f.currency_code || "GBP",
        min_order_yards: num(f.min_order_yards) || 1, description: f.description || "",
        photos: (f.photos || []).map(p => `sb:${FABRIC_PHOTOS}/${p}`),
        status: f.status || "approved", review_note: f.review_note || "", reviewed_at: day(f.reviewed_at),
        sold_out: !!f.sold_out, deleted_at: day(f.deleted_at), created_at: iso(f.created_at), updated_at: day(f.updated_at)
      })),

      staff: r.tailors.filter(t => t.active !== false).map(t => ({ id: t.id, name: t.name, role: t.role, phone: t.phone || "", designer_id: t.designer_id })),

      customers: r.customers.map(c => ({
        id: c.id, name: c.name || "Customer", email: c.email || "", phone: c.phone || "",
        auth_user_id: c.auth_user_id || null, added_by_designer_id: c.added_by_designer_id || null, created_at: day(c.created_at) || today(),
        country_code: c.country_code || null, currency_code: c.currency_code || null, measurement_unit: c.measurement_unit || "in",
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
          // In the tailor's currency; the seller's side and the exchange rate used (supabase/worldwide.sql)
          currency_code: o.currency_code || "GBP", fabric_currency_code: o.fabric_currency_code || null,
          fabric_price_per_yard: num(o.fabric_price_per_yard), fabric_cost_in_fabric_currency: num(o.fabric_cost_in_fabric_currency),
          exchange_rate: num(o.exchange_rate), exchange_rate_date: o.exchange_rate_date || null, exchange_rate_source: o.exchange_rate_source || "",
          fabric_unit: o.fabric_unit || "yd",
          deposit_paid_at: day(o.deposit_paid_at), balance_paid_at: day(o.balance_paid_at),
          stage: STAGES.some(s => s.key === o.stage) ? o.stage : "tailor_assigned",
          assigned_staff: {
            cutting: o.assigned_cutting || "", sewing: o.assigned_sewing || "", embroidery: o.assigned_embroidery || "",
            finishing: o.assigned_finishing || "", quality_control: o.assigned_quality_control || ""
          },
          review_rating: o.review_rating || null, review_text: o.review_text || "",
          // Before tailor-quote.sql has run there's no quote_status: every order is an accepted one
          quote_status: o.quote_status || "accepted", quoted_at: day(o.quoted_at), accepted_at: day(o.accepted_at),
          fabric_problem: o.fabric_problem || null,
          due_date: day(o.due_date) || addDays(14, day(o.created_at) || today()),
          created_at: day(o.created_at) || today(), updated_at: day(o.updated_at) || today()
        };
      }),

      payments: r.payments.map(p => ({
        id: p.id, order_id: numberOf.get(p.order_id), amount: num(p.amount), method: p.method, kind: p.kind,
        status: p.status, date: day(p.paid_on || p.created_at), confirmed_at: day(p.confirmed_at), currency_code: p.currency_code || "GBP"
      })).filter(p => p.order_id),

      invoices: r.invoices.filter(i => numberOf.has(i.order_id)).map(i => ({
        id: i.invoice_number || "INV-" + String(numberOf.get(i.order_id)).replace(/^\D+/, ""), order_id: numberOf.get(i.order_id),
        line_items: i.line_items || [], total: num(i.total), created_at: day(i.created_at), currency_code: i.currency_code || "GBP"
      })),

      deliveries: r.deliveries.filter(d => numberOf.has(d.order_id)).map(d => ({
        id: d.id, order_id: numberOf.get(d.order_id), courier: d.courier || "", tracking_number: d.tracking_number || "",
        status: d.status || "Order ready", eta: day(d.eta), updated: day(d.updated_at || d.created_at)
      })),

      fabric_orders: r.fabric_order_lines.map(l => ({
        id: l.id, ref: "FO-" + String(l.order_number || "").replace(/^\D+/, ""), order_id: numberOf.get(l.order_id) || l.order_number,
        seller_id: l.supplier_id, fabric_id: l.fabric_id, fabric_name: l.fabric_name, yards: num(l.yards),
        price_per_yard: num(l.price_per_yard), total: num(l.total), customer_first_name: l.customer_first_name || "",
        deliver_to: l.deliver_to || "", status: l.status, created_at: day(l.created_at), sent_at: day(l.sent_at), currency_code: l.currency_code || "GBP"
      })),

      wedding_orders: r.wedding_orders.map(w => ({
        id: w.id, designer_id: w.designer_id, event_name: w.event_name || "", event_date: day(w.event_date),
        members: r.wedding_order_members.filter(m => m.wedding_order_id === w.id).map(m => ({
          id: m.id, role: m.role, name: m.name || "", outfits: m.outfits || 1, order_id: numberOf.get(m.order_id) || "", status: m.status || "Not started"
        }))
      })),

      ready_to_wear: r.ready_to_wear_items.filter(i => i.active !== false).map(i => ({
        id: i.id, designer_id: i.designer_id, name: i.name, price: num(i.price), cost: num(i.cost) || 0, stock: i.stock || 0, color: i.colour_hex || "#1e2a44",
        currency_code: i.currency_code || "GBP"
      })),
      rtw_sales: r.ready_to_wear_sales.map(s => ({
        id: s.id, item_id: s.item_id, customer_id: s.customer_id, price: num(s.price), cost: num(s.cost) || 0,
        date: day(s.sold_on || s.created_at), status: s.status, currency_code: s.currency_code || "GBP"
      })),

      // Empty until supabase/prices.sql has been run; the starting prices are used until then
      prices: r.price_list.map(p => ({ id: p.id, designer_id: p.designer_id, kind: p.kind, name: p.name, price: num(p.price), yards: num(p.yards),
        currency_code: p.currency_code || "GBP" })),

      messages: messagesFrom(r.order_messages, numberOf, r.hidden_originals),
      delivery_details: (r.delivery_details || []).filter(x => numberOf.has(x.order_id)).map(x => ({
        order_id: numberOf.get(x.order_id), unlocked: !!x.unlocked, tailor_address: x.tailor_address || "", delivery_address: x.delivery_address || "" })),
      chat_reads: keepLocalReads(readsFrom(r.order_chat_reads, numberOf), previous && previous.chat_reads),

      reviews: r.reviews.map(v => ({
        id: v.id, order_id: numberOf.get(v.order_id) || null, designer_id: v.designer_id, customer_id: v.customer_id,
        rating: v.rating, review_text: v.review_text || "", created_at: day(v.created_at)
      })),

      session: {
        designerId: (previous && previous.session && previous.session.designerId) || (state.me && state.me.designer_id) || null,
        customerId: state.me && state.me.customer_id || (previous && previous.session && previous.session.customerId) || null,
        sellerId: (previous && previous.session && previous.session.sellerId) || (state.me && state.me.supplier_id) || null
      },
      draft: previous ? previous.draft : loadDraft(),
      counters: { order: 0, payment: 0, invoice: 0 },
      sample_sellers_added: true,
      version: 4
    };
    // Tailors fetched for the search or a public page stay known
    (previous && previous.designers || []).forEach(d => { if (!data.designers.some(x => x.id === d.id) && d.from_search) data.designers.push(d); });
    (previous && previous.prices || []).forEach(p => { if (!data.prices.some(x => x.id === p.id) && data.designers.some(d => d.id === p.designer_id && d.from_search)) data.prices.push(p); });
    // Someone who signed up as a seller but hasn't opened their shop yet
    if (data.session.sellerId && !data.suppliers.some(s => s.id === data.session.sellerId)) data.session.sellerId = null;
    if (!data.session.sellerId && state.me) {
      const mine = data.suppliers.find(s => s.owner_user_id === state.me.user_id);
      if (mine) data.session.sellerId = mine.id;
    }
    return data;
  }

  // ---- Order chats ----

  // The database still writes the platform's old name (Wearvia) in a few
  // places — system chat messages and some error messages. Show the new one.
  function newName(text) { return String(text).replace(/\bWearvia\b/g, APP_NAME); }

  // originals: only loaded for the NebedaHub admin (the database gives nobody else any)
  function messagesFrom(rows, numberOf, originals) {
    const original = new Map((originals || []).map(o => [o.source_id, o.original]));
    return rows.filter(m => numberOf.has(m.order_id)).map(m => ({
      id: m.id, order_id: numberOf.get(m.order_id), sender_kind: m.sender_kind, sender_name: newName(m.sender_name || ""),
      body: m.sender_kind === "system" ? newName(m.body || "") : m.body || "", photos: (m.photos || []).map(p => `sb:${CHAT}/${p}`), created_at: new Date(m.created_at).toISOString(),
      contact_hidden: !!m.contact_hidden, original_body: original.get(m.id) || undefined
    }));
  }

  function readsFrom(rows, numberOf) {
    return rows.filter(x => numberOf.has(x.order_id)).map(x => ({
      order_id: numberOf.get(x.order_id), side: x.side, last_read_at: new Date(x.last_read_at).toISOString()
    }));
  }

  // A chat marked read on this device a moment ago stays read while the database catches up
  function keepLocalReads(rows, local) {
    (local || []).forEach(mine => {
      const row = rows.find(r => r.order_id === mine.order_id && r.side === mine.side);
      if (!row) rows.push(mine);
      else if (mine.last_read_at > row.last_read_at) row.last_read_at = mine.last_read_at;
    });
    return rows;
  }

  // Just the chats — checked every few seconds while a chat is open. Returns true if anything changed.
  async function refreshChat() {
    if (!state.live || !state.me || !db) return false;
    const [messages, reads] = await Promise.all([
      state.client.from("order_messages").select("*").order("created_at", { ascending: true }),
      state.client.from("order_chat_reads").select("*")
    ]);
    if (messages.error || reads.error || !db) return false;
    const numberOf = new Map(db.orders.map(o => [o._uuid, o.id]));
    const before = JSON.stringify([db.messages, db.chat_reads]);
    const originals = new Map((db.messages || []).filter(m => m.original_body).map(m => [m.id, { source_id: m.id, original: m.original_body }]));
    db.messages = messagesFrom(messages.data || [], numberOf, Array.from(originals.values()));
    db.chat_reads = keepLocalReads(readsFrom(reads.data || [], numberOf), db.chat_reads);
    return JSON.stringify([db.messages, db.chat_reads]) !== before;
  }

  function sendMessage(order, body, photoRefs) {
    return run(async () => {
      const { error } = await state.client.from("order_messages").insert({
        order_id: order._uuid, body, photos: photoRefs.map(ref => photoPath(ref, CHAT)).filter(Boolean)
      });
      if (error) throw new Error(friendly(error));
      photoRefs.forEach(ref => state.localPhotos.delete(ref));
      await refreshChat();
      if (state.me && state.me.is_admin) await loadHiddenOriginals();
      const side = isTeam() ? "team" : "customer";
      if (!db.chat_reads.some(r => r.order_id === order.id && r.side === side)) db.chat_reads.push({ order_id: order.id, side, last_read_at: "" });
      db.chat_reads.find(r => r.order_id === order.id && r.side === side).last_read_at = new Date().toISOString();
    });
  }

  // The NebedaHub admin sees what was hidden, for safety
  async function loadHiddenOriginals() {
    const rows = await fetchAll("hidden_contact_details", "created_at", "source, source_id, original", q => q.eq("source", "chat")).catch(() => []);
    const original = new Map(rows.map(o => [o.source_id, o.original]));
    (db.messages || []).forEach(m => { if (original.has(m.id)) m.original_body = original.get(m.id); });
  }

  function markChatRead(order) {
    if (!order || !order._uuid) return;
    state.client.rpc("wearvia_mark_chat_read", { p_order_id: order._uuid }).then(({ error }) => {
      if (error) console.warn("Couldn't mark the chat as read:", error.message);
    });
  }

  // ---- Quotes: the customer sends their order, the team quotes, the customer accepts ----

  function requestQuote(details) {
    return run(async () => {
      await push();                     // their measurements must be saved first
      const id = newId();
      const insp = details.inspiration;
      // No yards and no prices: the database ignores them from a customer anyway
      const row = {
        id, customer_id: details.customerId, designer_id: details.designerId || draftDesignerId(),
        outfit_type: details.outfit, colour: details.colour, embroidery: details.embroidery,
        sleeve_style: details.sleeve, neck_style: details.neck, concept_variation: details.variation || 1,
        measurement_profile_id: details.profileId || null, fabric_id: details.fabric.id,
        inspiration_photos: insp ? insp.photos.map(ref => photoPath(ref, STYLE)).filter(Boolean) : [],
        inspiration_link: insp ? insp.link || null : null, inspiration_note: insp ? insp.note || null : null
      };
      const created = await state.client.from("orders").insert(row).select("id, order_number").single();
      if (created.error) {
        await load().catch(() => {});
        throw new Error(friendly(created.error));
      }
      if (details.note) {
        const note = await state.client.from("order_messages").insert({ order_id: id, body: details.note });
        if (note.error) console.warn("The note to the tailor couldn't be sent:", note.error.message);
      }
      await load();
      return db.orders.find(o => o._uuid === id);
    });
  }

  // length is in yards, or metres when unit is "m"; the database converts and prices it
  function sendQuote(order, fabricId, length, note, unit) {
    return run(async () => {
      await push();
      const { error } = await state.client.rpc("wearvia_send_quote", {
        p_order_id: order._uuid, p_yards: length, p_fabric_id: fabricId || null, p_note: note || null, p_unit: unit || "yd"
      });
      if (error) {
        await load().catch(() => {});
        throw new Error(friendly(error));
      }
      await load();
      return db.orders.find(o => o._uuid === order._uuid);
    });
  }

  function acceptQuote(order) {
    return run(async () => {
      const { data, error } = await state.client.rpc("wearvia_accept_quote", { p_order_id: order._uuid, p_total: order.quote_total });
      await load().catch(() => {});
      if (error) throw new Error(friendly(error));
      return data || { ok: false };
    });
  }

  // ---- The draft order (kept on this device until it's sent to the tailor) ----

  function draftKey() { return "wearvia-draft-" + (state.me ? state.me.user_id : "anon"); }

  function loadDraft() {
    try { return upgradeDraftToQuotes(upgradeDraftToYards(JSON.parse(localStorage.getItem(draftKey()) || "null")), null); } catch (e) { return null; }
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
        logo_url: s.logo || null, owner_user_id: s.owner_user_id || null, country_code: s.country_code || null, currency_code: s.currency_code || null })) },
    { table: "fabrics", rows: d => d.fabrics.map(f => ({
        id: f.id, supplier_id: f.supplier_id, name: f.name, category: f.category, colour_name: f.colour_name || null,
        colour_hex: f.color || null, price_per_yard: f.price_per_yard, yards_available: f.yards_available,
        min_order_yards: f.min_order_yards, description: f.description || "",
        photos: (f.photos || []).map(ref => photoPath(ref, FABRIC_PHOTOS)).filter(Boolean),
        status: f.status, review_note: f.review_note || "", sold_out: !!f.sold_out,
        deleted_at: f.deleted_at ? new Date(f.deleted_at + "T12:00:00Z").toISOString() : null })) },
    { table: "customers", rows: d => d.customers.map(c => ({ id: c.id, name: c.name, email: c.email || null, phone: c.phone || null,
        added_by_designer_id: c.added_by_designer_id || null, country_code: c.country_code || null, currency_code: c.currency_code || null,
        measurement_unit: c.measurement_unit || null })) },
    { table: "measurement_profiles", rows: d => d.customers.flatMap(c => c.measurement_profiles.map(p => ({
        id: p.id, customer_id: c.id, label: p.label, chest: p.chest, waist: p.waist, shoulder: p.shoulder, sleeve: p.sleeve,
        trouser_length: p.trouser_length, neck: p.neck, hip: p.hips, garment_length: p.length }))) },
    { table: "tailors", rows: d => d.staff.map(s => ({ id: s.id, designer_id: s.designer_id || bizDesignerId(), name: s.name, role: s.role, phone: s.phone || "" })) },
    { table: "wedding_orders", rows: d => d.wedding_orders.map(w => ({ id: w.id, designer_id: w.designer_id || bizDesignerId(), event_name: w.event_name, event_date: w.event_date })) },
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
        id: i.id, designer_id: i.designer_id || bizDesignerId(), name: i.name, price: i.price, cost: i.cost, stock: i.stock, colour_hex: i.color })) },
    { table: "price_list", rows: d => (d.prices || []).map(p => ({
        id: p.id, price: p.price, yards: p.kind === "outfit" ? p.yards : null })) },
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
      const own = details.ownPrices || {};
      const typed = value => value === "" || value == null ? null : Number(value);
      const id = newId();
      const insp = details.inspiration;
      const row = {
        id, customer_id: details.customerId, designer_id: bizDesignerId(),
        outfit_type: details.outfit, colour: details.colour, embroidery: details.embroidery,
        sleeve_style: details.sleeve, neck_style: details.neck, concept_variation: details.variation || 1,
        measurement_profile_id: details.profileId || null,
        // Stock is in yards; the database prices the fabric in the seller's currency and converts it
        fabric_id: details.fabric.id, fabric_yards: details.quote.yards, fabric_unit: details.quote.unit,
        // The team's own prices on a walk-in order are kept (in the tailor's currency);
        // anything left blank comes from the price list, and the database writes the itemised quote
        tailoring_cost: typed(own.tailoring), embroidery_cost: typed(own.embroidery), delivery_cost: typed(own.delivery),
        deposit_amount: details.depositTyped ? details.deposit : null,
        inspiration_photos: insp ? insp.photos.map(ref => photoPath(ref, STYLE)).filter(Boolean) : [],
        inspiration_link: insp ? insp.link || null : null, inspiration_note: insp ? insp.note || null : null,
        due_date: details.dueDate || addDays(14)
      };
      const created = await state.client.from("orders").insert(row).select("id, order_number, deposit_amount").single();
      if (created.error) {
        // Usually a price changed since the quote was shown: load the new prices so the quote shows them
        await load().catch(() => {});
        throw new Error(friendly(created.error));
      }
      const deposit = num(created.data.deposit_amount);
      if (deposit > 0) {
        const paid = await state.client.from("payments").insert({
          id: newId(), order_id: id, amount: deposit, method: details.method, kind: "Deposit",
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
    const bucket = folder === "style" ? STYLE : folder === "chat" ? CHAT : folder === "logo" ? LOGOS : folder === "designer" ? DESIGNER_PHOTOS : FABRIC_PHOTOS;
    const path = `${state.me.user_id}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await state.client.storage.from(bucket).upload(path, dataUrlToBlob(dataUrl), { contentType: "image/jpeg", upsert: false });
    if (error) throw new Error(friendly(error));
    if (bucket === LOGOS || bucket === DESIGNER_PHOTOS) return publicUrl(bucket, path);
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
    if (!PRIVATE_BUCKETS.includes(where.bucket)) return publicUrl(where.bucket, where.path);
    if (state.signedUrls.has(ref)) return state.signedUrls.get(ref);
    signSoon(ref);
    return state.localPhotos.get(ref) || "";
  }

  // Private photos (style photos, chat photos) need a short-lived link; ask for them in one batch per bucket
  let signTimer = null;
  function signSoon(ref) {
    if (state.signing.has(ref)) return;
    state.signing.add(ref);
    clearTimeout(signTimer);
    signTimer = setTimeout(async () => {
      const waiting = Array.from(state.signing).filter(r => !state.signedUrls.has(r));
      let drawn = false;
      for (const bucket of PRIVATE_BUCKETS) {
        const refs = waiting.filter(r => splitRef(r).bucket === bucket);
        if (!refs.length) continue;
        const { data, error } = await state.client.storage.from(bucket).createSignedUrls(refs.map(r => splitRef(r).path), 60 * 60);
        if (error) { console.warn(error); refs.forEach(r => state.signing.delete(r)); continue; }
        data.forEach((item, i) => { if (item.signedUrl) state.signedUrls.set(refs[i], item.signedUrl); });
        if (refs.some(r => !state.localPhotos.has(r))) drawn = true;
      }
      if (drawn) {
        if (isTyping() && typeof updateChatLogs === "function") updateChatLogs();
        requestRender();
      }
    }, 30);
  }

  // ---- Team logins (owner only) ----

  async function loadTeamLogins() {
    const { data, error } = await state.client.rpc("wearvia_team_logins", { p_designer_id: bizDesignerId() });
    if (error) throw new Error(friendly(error));
    state.teamLogins = data || [];
    return state.teamLogins;
  }

  async function addTeamLogin(email, jobRole) {
    const { data, error } = await state.client.rpc("wearvia_add_team_member", { p_email: email, p_job_role: jobRole, p_designer_id: bizDesignerId() });
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

  // ---- Tailors: joining, profiles, approval, searching ----

  // A signed-in person opens their tailor business (it waits for the admin)
  async function registerDesigner(details) {
    const { data, error } = await state.client.rpc("wearvia_register_designer", {
      p_business_name: details.businessName, p_country_code: details.country || null, p_city: details.city || null, p_phone: details.phone || null
    });
    if (error) throw new Error(friendly(error));
    if (details.acceptTerms) await acceptTailorTerms(data, true);
    state.teamLogins = null;
    await afterSignIn();
    if (db) db.session.designerId = data;
    return data;
  }

  // A tailor (or their staff) who wants to order outfits too: their own customer record
  async function becomeCustomer() {
    const me = state.me || {};
    const { error } = await state.client.from("customers")
      .insert({ id: newId(), auth_user_id: me.user_id, name: me.name || String(me.email || "").split("@")[0], created_at: new Date().toISOString() });
    if (error) throw new Error(friendly(error));
    await afterSignIn();
  }

  // The tailor agrees not to take NebedaHub customers off the platform
  async function acceptTailorTerms(designerId, quiet) {
    const { error } = await state.client.rpc("wearvia_accept_tailor_terms", { p_designer_id: designerId, p_version: TAILOR_TERMS_VERSION });
    if (error) throw new Error(friendly(error));
    if (!quiet) await load();
  }

  // The customer's delivery address for an order. Both sides see it (with the
  // tailor's business address) once the deposit is confirmed.
  function setDeliveryAddress(order, address) {
    return run(async () => {
      const { error } = await state.client.rpc("wearvia_set_delivery_address", { p_order_id: order._uuid, p_address: address });
      if (error) throw new Error(friendly(error));
      await load();
    });
  }

  // The owner saves their profile. The database works out what the public sees.
  async function saveDesignerProfile(id, fields) {
    await flush();
    const { data, error } = await state.client.from("designers").update(fields).eq("id", id).select("id");
    if (error) throw new Error(friendly(error));
    if (!data || !data.length) throw new Error("You don't have permission to change that profile.");
    await load();
  }

  async function addPortfolioItem(designerId, imageUrl, title) {
    const { error } = await state.client.from("designer_portfolio_items").insert({
      designer_id: designerId, image_url: imageUrl, title: title || null, sort_order: Date.now() % 1000000 });
    if (error) throw new Error(friendly(error));
    await load();
  }

  async function removePortfolioItem(item) {
    const { error } = await state.client.from("designer_portfolio_items").delete().eq("id", item.id);
    if (error) throw new Error(friendly(error));
    const where = splitRef(item.image);
    if (where && state.me && where.path.startsWith(state.me.user_id + "/")) state.client.storage.from(where.bucket).remove([where.path]).catch(() => {});
    await load();
  }

  async function setDesignerStatus(id, status, note) {
    const { error } = await state.client.rpc("wearvia_set_designer_status", { p_designer_id: id, p_status: status, p_note: note || "" });
    if (error) throw new Error(friendly(error));
    await load();
  }

  async function addSpeciality(name) {
    const { error } = await state.client.from("specialities").insert({ name, sort_order: 100 });
    if (error) throw new Error(/duplicate|unique/i.test(error.message || "") ? `"${name}" is already on the list.` : friendly(error));
    await load();
  }

  function saveCustomerNotes(designerId, customerId, notes) {
    return state.client.from("designer_customer_notes")
      .upsert({ designer_id: designerId, customer_id: customerId, notes, updated_at: new Date().toISOString() })
      .then(({ error }) => { if (error) throw new Error(friendly(error)); });
  }

  // A client that works before anyone signs in (the tailor search is public)
  function publicClient() {
    if (state.client) return state.client;
    if (!state.anon) state.anon = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
    return state.anon;
  }

  async function searchTailors(p) {
    const { data, error } = await publicClient().rpc("wearvia_search_tailors", {
      p_lat: p.lat ?? null, p_lng: p.lng ?? null, p_radius_km: p.radiusKm ?? null, p_country: p.country || null,
      p_city: p.city || null, p_area: p.area || null, p_specialities: p.specialities && p.specialities.length ? p.specialities : null,
      p_delivery: p.delivery || null, p_custom: p.custom || null, p_min_rating: p.minRating || null,
      p_sort: p.sort || "distance", p_limit: p.limit || 20, p_offset: p.offset || 0
    });
    if (error) throw new Error(friendly(error));
    const rows = (data || []).map(row => Object.assign(designerFrom(row), { distance_km: num(row.distance_km), from_search: true }));
    rows.forEach(remember);
    return { rows, total: data && data.length ? Number(data[0].total_count) : 0 };
  }

  // A tailor's public page: profile, portfolio, services, latest reviews
  async function tailorPage(slug) {
    const { data, error } = await publicClient().rpc("wearvia_tailor_page", { p_slug: slug });
    if (error) throw new Error(friendly(error));
    if (!data) return null;
    const d = Object.assign(designerFrom(data), { from_search: true, services: data.services || [],
      page_reviews: (data.reviews || []).map(r => ({ rating: r.rating, text: r.text || "", who: r.who, outfit: r.outfit || "" })),
      portfolio: (data.portfolio || []).map(p => ({ id: p.id, image: p.image_url, title: p.title || p.caption || "" })) });
    remember(d);
    return d;
  }

  // Keeps a tailor from a search or a page so the order flow can use it
  function remember(d) {
    if (!db) return;
    const mine = db.designers.find(x => x.id === d.id);
    if (mine && mine.is_mine) return;
    if (mine) Object.assign(mine, d); else db.designers.push(d);
  }

  // The price list of the tailor a customer is about to order from
  async function ensurePrices(designerId) {
    if (!state.live || !designerId || !db || pricesOf(designerId).length) return;
    const { data, error } = await publicClient().from("price_list").select("*").eq("designer_id", designerId).order("sort_order");
    if (error) { console.warn(error.message); return; }
    (data || []).forEach(p => { if (!db.prices.some(x => x.id === p.id)) db.prices.push({ id: p.id, designer_id: p.designer_id, kind: p.kind, name: p.name, price: num(p.price), yards: num(p.yards), currency_code: p.currency_code || "GBP" }); });
  }

  // Countries, specialities, currencies and exchange rates before anyone signs in
  // (for "Join as a tailor", the phone picker and approximate prices)
  async function loadPublicLists() {
    const client = publicClient();
    const [countries, specialities, currencies, rates] = await Promise.all([
      client.from("countries").select("*").order("sort_order"), client.from("specialities").select("*").order("sort_order"),
      client.from("currencies").select("*").order("sort_order"), client.from("exchange_rates").select("*")]);
    return { countries: countries.data || [], specialities: specialities.data || [], currencies: currencies.data || [], exchange_rates: rates.data || [] };
  }

  // Any prices still in another currency are put into the tailor's own (supabase/worldwide.sql)
  async function convertPriceList(designerId) {
    await flush();
    const { data, error } = await state.client.rpc("wearvia_convert_price_list", { p_designer_id: designerId });
    if (error) throw new Error(friendly(error));
    await load();
    return data;
  }

  return {
    get live() { return state.live; },
    get me() { return state.me; },
    GUEST_SCREENS, isGuest, startGuest,
    get teamLogins() { return state.teamLogins; },
    start, afterSignIn, signIn, signUp, signOut, sendPasswordReset, setNewPassword,
    enterDemo, leaveDemo, newId, isTeam, isOwner, homeRoute, becomeCustomer,
    save, flush, refresh, refreshIfStale, placeOrder, deleteOrder,
    requestQuote, sendQuote, acceptQuote, sendMessage, markChatRead, refreshChat,
    uploadPhoto, removePhoto, photoUrl,
    loadTeamLogins, addTeamLogin, removeTeamLogin,
    registerDesigner, acceptTailorTerms, setDeliveryAddress, saveDesignerProfile, addPortfolioItem, removePortfolioItem, setDesignerStatus, addSpeciality,
    saveCustomerNotes, searchTailors, tailorPage, ensurePrices, loadPublicLists, convertPriceList
  };
})();
