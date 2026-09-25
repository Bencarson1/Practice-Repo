// ============================================================
// tailor-join.js — the Tailors welcome page (#/for-tailors)
// Like the fabric sellers' page: how joining works, why join, and a
// button into the existing "Join as a tailor" sign-up. Approved tailors
// run their business from the Business dashboard, which is unchanged.
// ============================================================

// The tailor business the signed-in person owns or works for, if any
function myTailorBusiness() {
  if (Cloud.live) {
    const list = (Cloud.me && Cloud.me.designers) || [];
    const mine = list.find(x => x.is_owner) || list[0];
    return mine ? Object.assign({}, mine, designerById(mine.id) || {}) : null;
  }
  // Demo: a tailor made with "Join as a tailor" in this browser
  const d = db.session && db.session.designerId ? designerById(db.session.designerId) : null;
  return d && d.demo ? d : null;
}

function renderTailorJoin() {
  document.getElementById("join-tabs").innerHTML = `<a class="tab active" href="#/for-tailors">Tailors on ${APP_NAME}</a>`;
  document.getElementById("join-content").innerHTML = tailorWelcome();
  document.title = `Join as a tailor · ${APP_NAME}`;
}

function startTailorJoin() {
  if (Cloud.live && !Cloud.me) Auth.startSignUp("designer");
  else go("joinTailor");
}

function tailorWelcome() {
  const mine = myTailorBusiness();
  const status = mine ? mine.admin_status : null;
  let join;
  if (status === "approved") {
    join = `<div class="card">
        <h2>${escapeHtml(mine.business_name)}</h2>
        <p class="hint">You're an approved tailor on ${APP_NAME}. Your quotes, chats, orders and payments are in your Business dashboard.</p>
        <a class="button" href="#/biz/dashboard">Open your Business dashboard</a>
      </div>`;
  } else if (status === "pending") {
    join = `<div class="card">
        <h2>Waiting for approval</h2>
        <p class="hint">Thanks for joining! The ${APP_NAME} team is checking <b>${escapeHtml(mine.business_name)}</b>. We'll approve you as soon as we can — then customers near you can find you.</p>
        <p class="hint">While you wait, add your photo, specialities and portfolio in My profile.</p>
        <a class="button ghost" href="#/biz/profile">Finish your profile</a>
      </div>`;
  } else if (mine) {
    join = `<div class="card">
        <h2>${escapeHtml(mine.business_name)}</h2>
        <p class="hint">Your tailor profile is hidden from customers at the moment. Open My profile to see why and what to change.</p>
        <a class="button ghost" href="#/biz/profile">Open My profile</a>
      </div>`;
  } else {
    join = `<div class="card">
        <h2>New tailor or designer</h2>
        <p class="hint">It takes about two minutes.</p>
        <button class="gold" onclick="startTailorJoin()">Join as a tailor or designer</button>
      </div>`;
  }
  return `
    ${bizHeader(`Join ${APP_NAME} as a tailor or designer`, `Get found by customers near you, and run every order from one place.`)}
    <ol class="how-steps">
      <li><b>Create your tailor profile</b><span>Your business name, where you are, and the ${APP_NAME} tailor terms.</span></li>
      <li><b>Show your work and set your prices</b><span>Add your photo, specialities and portfolio, and your prices for each outfit.</span></li>
      <li><b>Get approved and receive orders</b><span>The ${APP_NAME} team checks your profile, then customers can find you and send quote requests.</span></li>
    </ol>
    <div class="card">
      <h2>Why join ${APP_NAME}</h2>
      <ul class="benefit-list">
        <li>Customers near you looking for a tailor</li>
        <li>Listed in <b>Find tailors near me</b> and on Google</li>
        <li>Secure payments through ${APP_NAME}</li>
        <li>Quote requests and a chat with each customer</li>
        <li>Order and production tools to keep track of every outfit</li>
      </ul>
    </div>
    <div class="two-col">
      ${join}
      <div class="card">
        <h2>Already a tailor?</h2>
        <p class="hint">Approved tailors run their business from the <b>Business dashboard</b>: quote requests, orders, production, payments and your team.${Cloud.live && !Cloud.me ? " Sign in to open it." : ""}</p>
        ${Cloud.live && !Cloud.me ? `<button class="ghost" onclick="Auth.show('signIn')">Sign in</button>` : ""}
      </div>
    </div>`;
}
