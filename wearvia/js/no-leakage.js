// ============================================================
// no-leakage.js — keeps orders on Wearvia
//
// Finds phone numbers, email addresses, website links, WhatsApp /
// Instagram / social handles and "call me on…" style messages, and hides
// them. The DATABASE does this for real (supabase/no-leakage.sql:
// wv_hide_contacts), so nobody can get round it by skipping the app; this
// copy uses the same rules so the demo and the screens behave the same,
// and so the Google pages builder can double-check what it publishes.
// ============================================================

const CONTACT_HIDDEN_TOKEN = "[contact details hidden]";
const CONTACT_HIDDEN_NOTICE = "Contact details are hidden. Please keep your order on Wearvia so you're protected.";
const PAY_PROTECTION_LINE = "Pay through Wearvia to be protected: your money is safe until your outfit is delivered.";
const TAILOR_TERMS_VERSION = "2026-09";
const TAILOR_TERMS = [
  "Customers who find you on Wearvia stay Wearvia customers: quotes, chats, payments and changes to their order go through Wearvia.",
  "You won't share or ask for phone numbers, email addresses, website links, WhatsApp, Instagram or other social handles in chats, your profile or your portfolio. Wearvia hides them automatically.",
  "You won't ask a Wearvia customer to pay you directly or to order from you outside Wearvia, now or later.",
  "Business and delivery addresses are shared in the app once the customer's deposit is confirmed — for delivery and fittings only.",
  "Wearvia can hide or remove a tailor who takes customers off the platform."
];

// The same patterns as the database (Postgres \m / \M are \b here)
const CONTACT_TLDS = "com|net|org|co|uk|ng|gh|ke|za|io|me|ly|ee|us|ca|app|shop|store|biz|info|online|site|link|page|africa|fashion|tv";
const CONTACT_SOCIAL = "ig|insta|instagram|tiktok|tik tok|snap|snapchat|facebook|fb|twitter|telegram|whatsapp|whats app|watsapp|signal";
// In this order: links and emails first (so their digits aren't taken for a
// phone number), then phone numbers, then handles and "call me on…".
const CONTACT_RULES = [
  ["link", /(https?:\/\/|www\.)[^\s]+/gi],
  ["email", /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi],
  ["phone", /\+?\(?[0-9][0-9\s().-]{6,}[0-9]/g],
  ["email", new RegExp(`\\b[a-z0-9._%+-]+(\\s+dot\\s+[a-z0-9_%+-]+)*\\s*[[(]?\\s*(at|@)\\s*[\\])]?\\s*[a-z0-9-]+\\s*[[(]?\\s*(dot|\\.)\\s*[\\])]?\\s*(${CONTACT_TLDS})\\b`, "gi")],
  ["link", new RegExp(`\\b[a-z0-9-]+(\\.[a-z0-9-]+)*\\.(${CONTACT_TLDS})\\b(/[^\\s]*)?`, "gi")],
  ["handle", /(^|[^a-z0-9._%+\]-])@[a-z0-9._]{2,30}/gi],
  ["handle", new RegExp(`\\b(my|our)\\s+(${CONTACT_SOCIAL}|number|phone|mobile|cell|email|e-mail|contact|line|website|site|page|handle)(\\s+(handle|page|account|name|id|number|no))?\\s*(is|:|-|=)\\s*[^\\s,;!?[]+`, "gi")],
  ["handle", new RegExp(`\\b(${CONTACT_SOCIAL})\\s*(handle|page|account|name|id|number|no)?\\s*(:|=|@)\\s*@?[a-z0-9._+-]{2,30}`, "gi")],
  ["contact_request", /\b(call|text|ring|phone|whats\s?app|dm|reach|contact|e-?mail|message|pay)\s+(me|us)\s+(on|at|via|through|directly|outside|privately|off)\b(?!\s+(here|this app|the app|wearvia))/gi],
  ["contact_request", /\b(outside|off)\s+(of\s+)?(the\s+)?(app|wearvia|platform)\b/gi],
  ["phone", /\b((zero|oh|one|two|three|four|five|six|seven|eight|nine|double|triple)[\s,.-]*){7,}/gi]
];

// A run of digits is a phone number when it has 9 or more digits and starts
// like one (+, 0 or a bracket) or has a group of 3+ digits — so measurement
// lists such as "38 40 42 44 46" and dates are left alone.
function looksLikePhone(text) {
  const digits = text.replace(/[^0-9]/g, "");
  return digits.length >= 9 && (/^[+0(]/.test(text) || /[0-9]{3}/.test(text));
}

// → { text, hidden: true/false, kinds: ["phone", "email", …] }
function hideContactDetails(input) {
  let text = String(input == null ? "" : input);
  const kinds = [];
  CONTACT_RULES.forEach(([kind, re], i) => {
    const digitsRule = i === 2;
    const keepsLead = re.source.startsWith("(^|");
    text = text.replace(re, (match, lead) => {
      if (digitsRule && !looksLikePhone(match)) return match;
      if (!kinds.includes(kind)) kinds.push(kind);
      return (keepsLead ? lead : "") + CONTACT_HIDDEN_TOKEN;
    });
  });
  // "[hidden] [hidden]" → "[hidden]"
  const token = CONTACT_HIDDEN_TOKEN.replace(/[[\]]/g, "\\$&");
  text = text.replace(new RegExp(`${token}([\\s,.;:/-]*${token})+`, "g"), CONTACT_HIDDEN_TOKEN);
  return { text, hidden: kinds.length > 0, kinds };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { hideContactDetails, CONTACT_HIDDEN_TOKEN, CONTACT_HIDDEN_NOTICE, PAY_PROTECTION_LINE, TAILOR_TERMS, TAILOR_TERMS_VERSION };
}
