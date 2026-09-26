// ============================================================
// chat.js — the chat on every order, between the customer and the
// Nebeda Threads team: text messages and photos
//
// It stays open for the whole order: agreeing the yards before the quote,
// then questions, fittings and updates while the outfit is made.
//
//   db.messages:   { id, order_id, sender_kind, sender_name, body, photos, created_at,
//                    contact_hidden, original_body }
//                  sender_kind is "customer", "team" or "system" (NebedaHub's own
//                  notes, e.g. "Your quote is ready"). Phone numbers, emails,
//                  links and social handles are hidden (contact_hidden); only
//                  the NebedaHub admin gets original_body, for safety.
//   db.chat_reads: { order_id, side, last_read_at } — when the customer / the
//                  team last read each chat, for the unread badges
//
// Live mode: the order_messages and order_chat_reads tables and the private
// "chat-photos" bucket (supabase/tailor-quote.sql). The database fills in who
// sent each message, so nobody can write as someone else, and hides contact
// details (supabase/no-leakage.sql) — the demo does the same with no-leakage.js.
// ============================================================

const CHAT_SHOWN = 40;          // newest messages shown; "Show earlier messages" shows the rest
const CHAT_MAX_PHOTOS = 4;      // per message
const CHAT_PHOTO_MAX_SIZE = 1280;
const CHAT_TEXT_MAX = 2000;
const CHAT_POLL_MS = 8000;      // while a chat is on screen (live mode)

const chatShowAll = {};         // orderId → true once "Show earlier messages" is pressed
const chatDrafts = {};          // orderId → { text, photos: [refs], adding } — what's being written
const chatPinned = {};          // orderId → false when scrolled up to read older messages
let chatSending = false;

function nowIso() {
  return new Date().toISOString();
}

// ---- Reading ----

function orderMessages(orderId) {
  return (db.messages || []).filter(m => m.order_id === orderId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function chatReadAt(orderId, side) {
  const row = (db.chat_reads || []).find(r => r.order_id === orderId && r.side === side);
  return row ? row.last_read_at : null;
}

// Messages the other side (or NebedaHub) wrote since this side last read the chat
function unreadCount(orderId, side) {
  const readAt = chatReadAt(orderId, side);
  return orderMessages(orderId).filter(m => m.sender_kind !== side && (!readAt || m.created_at > readAt)).length;
}

function unreadTotal(orders, side) {
  return orders.reduce((total, o) => total + unreadCount(o.id, side), 0);
}

function unreadBadge(count, label) {
  return count ? `<span class="chat-badge" aria-label="${count} unread message${count === 1 ? "" : "s"}${label ? " " + label : ""}">${count}</span>` : "";
}

// ---- Writing ----

function addChatMessage(order, kind, body, photos) {
  if (!db.messages) db.messages = [];
  const customer = findCustomer(order.customer_id);
  const name = kind === "team" ? designerName(order.designer_id) : kind === "system" ? APP_NAME : (customer ? customer.name : "Customer");
  const text = String(body || "").trim().slice(0, CHAT_TEXT_MAX);
  const filtered = kind === "system" ? { text, hidden: false } : hideContactDetails(text);
  const message = { id: newId("MSG", db.messages, 3), order_id: order.id, sender_kind: kind, sender_name: name,
    body: filtered.text, photos: photos || [], created_at: nowIso(), contact_hidden: filtered.hidden };
  if (filtered.hidden) message.original_body = text;
  db.messages.push(message);
  if (kind !== "system") setChatRead(order.id, kind);
  return message;
}

function addSystemMessage(order, body) {
  return addChatMessage(order, "system", body, []);
}

function setChatRead(orderId, side) {
  if (!db.chat_reads) db.chat_reads = [];
  let row = db.chat_reads.find(r => r.order_id === orderId && r.side === side);
  if (!row) {
    row = { order_id: orderId, side, last_read_at: "" };
    db.chat_reads.push(row);
  }
  row.last_read_at = nowIso();
}

// Called when a chat is on screen
function markChatRead(order, side) {
  if (!order || !unreadCount(order.id, side)) return;
  setChatRead(order.id, side);
  if (Cloud.live) Cloud.markChatRead(order);
  else saveData();
}

// ---- Drawing ----

function chatTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · ${time}`;
}

function chatMessageHtml(m, side) {
  const mine = m.sender_kind === side;
  const cls = m.sender_kind === "system" ? "system" : mine ? "mine" : "theirs";
  const photos = (m.photos || []).map((ref, i) => {
    const url = photoUrl(ref);
    return `<button type="button" class="chat-photo" onclick="openStyleViewer('msg:${m.id}', ${i})" aria-label="Open photo ${i + 1}">
      ${url ? `<img src="${url}" alt="" loading="lazy">` : `<span class="style-missing">Loading photo…</span>`}</button>`;
  }).join("");
  return `<div class="chat-msg ${cls}">
    ${cls === "theirs" ? `<div class="chat-who">${escapeHtml(m.sender_name || (m.sender_kind === "team" ? designerName((findOrder(m.order_id) || {}).designer_id) : "Customer"))}</div>` : ""}
    ${cls === "system" ? `<div class="chat-who">${escapeHtml(APP_NAME)}</div>` : ""}
    ${photos ? `<div class="chat-photos">${photos}</div>` : ""}
    ${m.body ? `<div class="chat-text">${escapeHtml(m.body)}</div>` : ""}
    ${m.contact_hidden ? `<div class="chat-hidden-note">🔒 ${escapeHtml(CONTACT_HIDDEN_NOTICE)}</div>` : ""}
    ${m.contact_hidden && m.original_body && isAdminUser() ? `<details class="chat-original"><summary>Original (only the ${escapeHtml(APP_NAME)} admin sees this)</summary>${escapeHtml(m.original_body)}</details>` : ""}
    <div class="chat-when">${chatTime(m.created_at)}</div>
  </div>`;
}

function chatLogInner(order, side) {
  const all = orderMessages(order.id);
  const shown = chatShowAll[order.id] ? all : all.slice(-CHAT_SHOWN);
  const hidden = all.length - shown.length;
  const other = side === "customer" ? designerName(order.designer_id) : (findCustomer(order.customer_id) || { name: "the customer" }).name.split(" ")[0];
  if (!all.length) {
    return `<div class="chat-empty">No messages yet. ${side === "customer"
      ? `Ask ${escapeHtml(other)} anything about your outfit — the fit, the fabric, fittings or delivery.`
      : isPlaced(order) ? `Send ${escapeHtml(other)} a message — questions, fittings or updates on their outfit.`
        : `Say hello to ${escapeHtml(other)}, or ask what you need to know to agree the yards.`}</div>`;
  }
  return `${hidden ? `<button type="button" class="linkish chat-earlier" onclick="showEarlierMessages('${order.id}')">Show ${hidden} earlier message${hidden === 1 ? "" : "s"}</button>` : ""}
    ${shown.map(m => chatMessageHtml(m, side)).join("")}`;
}

// The messages. In the customer app the whole screen scrolls; on the business pages the box does.
function chatLogHtml(order, side, scrolls) {
  return `<div class="chat-log ${scrolls ? "chat-scroll" : ""}" id="chat-log-${order.id}" data-order="${order.id}" data-side="${side}"
    ${scrolls ? `data-chat-scroll="${order.id}" onscroll="chatScrolled(this)"` : ""} role="log" aria-live="polite" aria-label="Messages">
    ${chatLogInner(order, side)}</div>`;
}

function chatDraftFor(orderId) {
  if (!chatDrafts[orderId]) chatDrafts[orderId] = { text: "", photos: [], adding: 0 };
  return chatDrafts[orderId];
}

function chatPhotoStrip(orderId) {
  const draftMsg = chatDraftFor(orderId);
  const tiles = draftMsg.photos.map((ref, i) => `<span class="chat-pending">
      <img src="${photoUrl(ref)}" alt="Photo ${i + 1} to send">
      <button type="button" onclick="removeChatPhoto('${orderId}', ${i})" aria-label="Remove photo ${i + 1}">×</button></span>`).join("");
  const busy = Array.from({ length: draftMsg.adding }, () => `<span class="chat-pending busy"><span class="gen-spin"></span></span>`).join("");
  return tiles + busy;
}

function chatComposerHtml(order, side) {
  const draftMsg = chatDraftFor(order.id);
  const room = CHAT_MAX_PHOTOS - draftMsg.photos.length - draftMsg.adding;
  const to = side === "customer" ? designerName(order.designer_id) : (findCustomer(order.customer_id) || { name: "customer" }).name.split(" ")[0];
  return `<form class="chat-composer" onsubmit="return sendChat(event, '${order.id}', '${side}')">
    <div class="chat-pending-row" id="chat-photos-${order.id}">${chatPhotoStrip(order.id)}</div>
    <div class="chat-compose-row">
      <label class="chat-attach ${room > 0 ? "" : "is-full"}" title="Add photos" aria-label="Add photos">
        <input type="file" accept="image/*" multiple onchange="addChatPhotos('${order.id}', this)" ${room > 0 ? "" : "disabled"}>📷</label>
      <textarea id="chat-text-${order.id}" rows="1" maxlength="${CHAT_TEXT_MAX}" placeholder="Message ${escapeHtml(to)}…"
        aria-label="Message ${escapeHtml(to)}" oninput="chatTyped('${order.id}', this)" onkeydown="chatKey(event, '${order.id}', '${side}')">${escapeHtml(draftMsg.text)}</textarea>
      <button type="submit" class="chat-send" aria-label="Send">Send</button>
    </div>
    <p class="chat-leak-hint" id="chat-hint-${order.id}" role="status" ${hideContactDetails(draftMsg.text).hidden ? "" : "hidden"}>🔒 ${escapeHtml(CONTACT_HIDDEN_NOTICE)}</p>
  </form>`;
}

// Chat box for the business pages
function chatPanel(order, side) {
  return `<div class="chat-panel">${chatLogHtml(order, side, true)}${chatComposerHtml(order, side)}</div>`;
}

// ---- Actions ----

function showEarlierMessages(orderId) {
  chatShowAll[orderId] = true;
  chatPinned[orderId] = false;
  renderAll();
}

function chatTyped(orderId, textarea) {
  chatDraftFor(orderId).text = textarea.value;
  // Phone numbers, emails, links and handles will be hidden: say so before it's sent
  const hint = document.getElementById("chat-hint-" + orderId);
  if (hint) hint.hidden = !hideContactDetails(textarea.value).hidden;
  // Grow with the text, up to a few lines
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, 140) + "px";
}

// Ctrl/⌘ + Enter sends (Enter alone makes a new line, which phones need)
function chatKey(event, orderId, side) {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendChat(null, orderId, side);
  }
}

function addChatPhotos(orderId, input) {
  const draftMsg = chatDraftFor(orderId);
  const files = Array.from(input.files || []);
  input.value = "";
  const room = CHAT_MAX_PHOTOS - draftMsg.photos.length - draftMsg.adding;
  if (room <= 0) return;
  if (files.length > room) toast(`Only ${room} more photo${room === 1 ? "" : "s"} added — up to ${CHAT_MAX_PHOTOS} per message.`);
  const picked = files.slice(0, room);
  draftMsg.adding += picked.length;
  redrawChatPhotos(orderId);
  picked.reduce((chain, file) => chain.then(() =>
    resizeImage(file, CHAT_PHOTO_MAX_SIZE, 0.8)
      .then(url => PhotoStore.put(url, "chat"))
      .then(ref => { draftMsg.photos.push(ref); })
      .catch(error => toast(error.message || "Couldn't add that photo."))
      .finally(() => { draftMsg.adding -= 1; redrawChatPhotos(orderId); })
  ), Promise.resolve());
}

function removeChatPhoto(orderId, index) {
  const draftMsg = chatDraftFor(orderId);
  const [ref] = draftMsg.photos.splice(index, 1);
  PhotoStore.remove(ref);
  redrawChatPhotos(orderId);
}

function redrawChatPhotos(orderId) {
  const el = document.getElementById("chat-photos-" + orderId);
  if (el) el.innerHTML = chatPhotoStrip(orderId);
  const draftMsg = chatDraftFor(orderId);
  const attach = el && el.parentElement.querySelector(".chat-attach");
  if (attach) {
    const full = draftMsg.photos.length + draftMsg.adding >= CHAT_MAX_PHOTOS;
    attach.classList.toggle("is-full", full);
    attach.querySelector("input").disabled = full;
  }
}

function sendChat(event, orderId, side) {
  if (event) event.preventDefault();
  const order = findOrder(orderId);
  const draftMsg = chatDraftFor(orderId);
  const box = document.getElementById("chat-text-" + orderId);
  if (box) draftMsg.text = box.value;
  const text = draftMsg.text.trim();
  if (!order || chatSending) return false;
  if (draftMsg.adding) { toast("One moment — your photos are still being added."); return false; }
  if (!text && !draftMsg.photos.length) { if (box) box.focus(); return false; }
  const photos = draftMsg.photos.slice();
  chatSending = true;
  const button = box && box.form.querySelector(".chat-send");
  if (button) button.disabled = true;
  const sent = Cloud.live ? Cloud.sendMessage(order, text, photos) : Promise.resolve(addChatMessage(order, side, text, photos));
  sent.then(() => {
    if (hideContactDetails(text).hidden) toast(CONTACT_HIDDEN_NOTICE);
    chatDrafts[orderId] = { text: "", photos: [], adding: 0 };
    chatPinned[orderId] = true;
    if (!Cloud.live) saveData();
    renderAll();
    const again = document.getElementById("chat-text-" + orderId);
    if (again) again.focus();
  }).catch(error => {
    toast(error.message || "Couldn't send your message. Please try again.");
    if (button) button.disabled = false;
  }).finally(() => { chatSending = false; });
  return false;
}

// ---- Keeping the newest message in view ----

function chatScrolled(el) {
  chatPinned[el.dataset.chatScroll] = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}

// After each redraw: scroll chats to the newest message (unless the person
// scrolled up to read), and mark what's on screen as read
function afterChatRender() {
  const logs = Array.from(document.querySelectorAll(".chat-log[data-order]"));
  if (!logs.length) return;
  requestAnimationFrame(() => {
    document.querySelectorAll("[data-chat-scroll]").forEach(el => {
      if (chatPinned[el.dataset.chatScroll] !== false) el.scrollTop = el.scrollHeight;
    });
  });
  logs.forEach(log => {
    const order = findOrder(log.dataset.order);
    if (order) markChatRead(order, log.dataset.side);
  });
}

// New messages arrived (live mode): redraw just the chats on screen, so
// anything being typed isn't lost, then the rest of the page when it's safe
function updateChatLogs() {
  document.querySelectorAll(".chat-log[data-order]").forEach(log => {
    const order = findOrder(log.dataset.order);
    if (order) log.innerHTML = chatLogInner(order, log.dataset.side);
  });
  afterChatRender();
}

// While a chat is on screen, check for new messages every few seconds
setInterval(() => {
  if (Cloud.live && Cloud.me && document.visibilityState === "visible" && document.querySelector(".chat-log[data-order]")) {
    Cloud.refreshChat().then(changed => { if (changed) updateChatLogs(); });
  }
}, CHAT_POLL_MS);
