# Wearvia

Wearvia is one web app for bespoke and ready-to-wear fashion:

- **Customers** design an outfit, see a design concept, save their measurements, choose a fabric and send it all to the tailor. They chat with Nebeda Threads in the app to agree how many yards they need, accept the tailor's quote, pay a deposit, track production and leave a review.
- **Fabric sellers** run a market stall of fabrics: photos, prices, stock, and the orders that use their fabric.
- **The designer** runs orders, production, the tailor team, fabric inventory, payments, weddings, ready-to-wear, deliveries and invoices from the same data.

The first shop using Wearvia is **Nebeda Threads** (Gillingham, Kent). Prices are in **£ (GBP)**.

It's plain HTML, CSS and JavaScript. There is nothing to install and no build step.
The look and the customer order flow come from `wearvia-prototype.html`; the full plan is in [`WEARVIA-SPEC.md`](../WEARVIA-SPEC.md).

## How to run it

### Option 1: Open the file (easiest)

1. Download or clone this repository.
2. Open the `wearvia` folder.
3. Double-click `index.html`. It opens in your web browser.

### Option 2: Run a small local web server

```bash
cd wearvia
python3 -m http.server 8000
```

Then go to <http://localhost:8000>. Press `Ctrl + C` in the terminal to stop the server.

The app opens on a **Sign in** page. To look around without an account, press **Try the demo** (or open the page with `?demo=1` on the end of the address, e.g. `index.html?demo=1`). The demo uses sample data kept in that browser only — nothing is sent to Supabase, so it's safe to show anyone.

Use the switch at the top right to move between the **Customer app**, the **Fabric sellers** area and the **Business dashboard** (the Business tab only appears for the Nebeda Threads team).

## The order steps

Every order follows these 16 steps, in this order (from the spec):

| # | Step | Where it happens |
|---|------|------------------|
| 1 | Customer chooses outfit type and design options | Customer app → outfit picker, then Design |
| 2 | AI design concept — approve or regenerate | Customer app → AI Design Concept |
| 3 | Measurements saved to the customer's profile | Customer app → My Measurements (saved as this year's profile) |
| 4 | Fabric selected from the marketplace | Customer app → Fabric Marketplace (photo grid from independent sellers, live stock), then **Send to tailor**. Nothing is bought yet and there's no price: the order is saved as a request, *Waiting for tailor's quote* |
| 5 | Tailor's quote | The yards can't be worked out from the outfit or measurements alone, so the tailor decides them. Business → **Quote requests** → open the request, chat with the customer, enter the yards (and another fabric if agreed) → **Send quote**. The price is yards × the seller's price per yard + tailoring + embroidery + delivery from the price list — worked out by the database |
| 6 | Quote accepted — fabric bought | Customer app → the order (or its chat) → **Accept quote**. Only now does the fabric come out of stock, the seller get their order line and the invoice get made. Or **Ask a question** in the chat instead |
| 7 | Deposit paid (60%) | Customer app → Pay deposit. Checkout is a demo, so the deposit shows as **awaiting confirmation** until Nebeda Threads confirms it in Business → Payments. Production can't start before that |
| 8 | Tailor assigned | Automatic when the quote is accepted: the least busy person in each role |
| 9–13 | Cutting → Sewing → Embroidery → Fitting → Quality control | Business → Production or the order page |
| 14 | Balance paid | Customer pays in their order, or the shop records it in Payments. Orders can't move on until it's paid |
| 15 | Delivery | Business → Deliveries: dispatch with a courier, then move the parcel along to *Delivered* |
| 16 | Customer leaves a review | Customer app → order → Leave a Review (only after delivery) |

The app won't let anyone skip a step: for example, nobody can pay before the quote is accepted. If the fabric sells out before the customer accepts, they're told in the chat and the request goes back to the tailor to suggest another fabric and send a new quote.

**The order chat.** Every order has a chat between the customer and the Nebeda Threads team — text and photos — that stays open for the whole order: agreeing the yards, then questions, fittings and updates. The newest messages show first (*Show earlier messages* for the rest), and both sides get a red unread badge (the customer on *Orders*, the team on *Quote requests* and *Orders*). The team sees the style photos, design and measurements next to the chat. Walk-in orders taken in the shop skip the quote: the team enters the yards directly.

## What's inside

**Customer app**

| Screen | What it does |
|--------|--------------|
| Home | Start an order, explore the marketplace, or open the business dashboard |
| Outfit picker & Design | Agbada, Kaftan, Senator, Bubu, Two Piece, Dress, Wedding, Suit, Aso Ebi, Custom; colour, embroidery, sleeve, neck |
| Upload a Style | *I have a photo of the style I want*: up to 5 photos (Instagram, TikTok or Pinterest screenshots, or camera photos), the link to the post, and a note such as "same dress but longer sleeves and in green" |
| AI Design Concept | A drawing made from the customer's choices. *Regenerate* makes a new version. Uploaded style photos show above it as *Your inspiration* |
| Measurements | Chest, waist, shoulder, sleeve, trouser length, neck (plus hips and length), saved per year |
| Fabric Marketplace | Photo grid of approved fabrics from every seller, priced per yard. Search, and filter by type, colour, price, seller and in-stock. Each fabric has a page with all its photos, description and seller. The customer only chooses the fabric — the tailor decides the yards |
| Send to tailor | A summary of the order, what happens next, and an optional note to the tailor. Nothing to pay |
| Chat | Text and photos with Nebeda Threads on every order, with the style photos and measurements one tap away |
| Quote & Payment | The tailor's itemised quote with *Accept quote* / *Ask a question*; then the deposit by card, Apple Pay or bank transfer (demo, no real money) |
| My Orders & Tracking | All 16 steps, who is working on it, balance due, invoice and delivery tracking |
| Designers, Ready to Wear, Profile | Nebeda Threads' profile and reviews, the ready-to-wear shop, and the customer's details |

**Business dashboard**

| Tab | What it does |
|-----|--------------|
| Dashboard | Order count, revenue, estimated profit, pending payments, customers waiting for a quote, new messages, late orders, low stock, what's due soon, and *Ask Wearvia AI* (answers from your data) |
| Quote requests | Customers who sent their order in. Open one to chat, see their style photos, design and measurements, enter the yards (or change the fabric) and *Send quote*. A live preview shows the quote before you send it |
| Orders | Every order being made, live (📷 marks orders with style photos, 💬 new messages). Take walk-in orders (you enter the yards). Open an order to chat with the customer, move it along, assign staff, take payments and dispatch it. If the customer uploaded a style, the order page opens with *Customer's style — copy this*: the photos (tap for full size), their note and the link |
| Production | A board of every order by the last step it finished. Orders with style photos show the photos, note and link on their card so the tailors know what to copy |
| Tailor Team | Who is doing cutting, sewing, embroidery, finishing and QC, and what's waiting for them |
| Customers | Order history, spend, favourite colour, notes and measurement profiles |
| Measurements | Save and edit any customer's measurements |
| Fabric Inventory | Live stock in yards, low-stock warnings (under 10 yd), restocking, new fabrics and suppliers |
| Fabric Sellers | Approve sellers' fabrics or hide them (with a reason the seller sees), and see every seller's shop, fabrics and sales |
| Payments | Record payments, see balances and payment history |
| Prices | Tailoring price for each outfit, embroidery prices and the delivery price. The database uses these in every quote the tailor sends. Typical yards is only a starting point for walk-in orders; customers never see it. Walk-in orders can use your own price instead |
| Wedding Orders | One event with many people, each with their own outfit and status |
| Ready to Wear | Items, stock and sales |
| Deliveries | Dispatch orders and update courier tracking |
| Invoices | Made automatically for every order; download (print to PDF) or share |

**Fabric sellers** (the *Fabric sellers* switch at the top)

| Tab | What it does |
|-----|--------------|
| Sell on Wearvia | Create a seller profile, or sign in as an existing shop (demo — no passwords yet) |
| My fabrics | The seller's stall: every fabric with its status (*Live*, *Waiting for approval*, *Hidden*, *Sold out*). Edit, mark sold out / back in stock, or delete |
| Add a fabric | Up to 5 photos (the first is the cover), name, type, colour, price per yard in £, yards in stock, smallest order (in yards) and a description |
| Orders | Every order that used the seller's fabric: yards, price, who it's for (first name only) and where to send it. *Mark as sent* when it's posted |
| Shop profile | Shop name, location, phone, delivery time and logo |

How approval works: new fabrics wait for Nebeda Threads to approve them before customers see them. Changing a live fabric's photos, name, type, colour or description sends it back for a quick check; price and stock changes go live straight away. If Nebeda Threads hides a fabric, the seller sees the reason on their stall.

Sample customers, fabrics, orders, payments and fabric sellers load automatically so you can try everything straight away. Twelve sample sellers are included — four with full market stalls (Mama Titi Wax Prints, Kente Corner, Indigo Adire Studio and Lace Lounge), with one fabric waiting for approval, one hidden and one sold out. Their photos are drawn patterns, so you can replace them with real ones.

## Try it out

- **Place an order as a customer:** Customer app → *Start an Order* → pick an outfit → design it → *Generate AI Concept* → *Approve* → enter your name and measurements → pick a fabric → *Continue with this fabric* → *Send to Tailor*. The order shows *Waiting for tailor's quote*; tap *Chat with Nebeda Threads* to send a message or photo.
- **Quote it as the tailor:** Business dashboard → *Quote requests* → open the request → reply in the chat → enter the yards → *Send quote*.
- **Accept it:** back in the Customer app, open the order → *Accept quote* → *Pay deposit*. The order shows *Deposit awaiting confirmation*. (The sample data already has one request waiting for a quote, NT-1009, and one quote waiting to be accepted, NT-1010.)
- **Confirm the deposit:** Business dashboard → *Payments* → *Awaiting confirmation* → *✓ Confirm*.
- **Order from a photo:** Customer app → *Start an Order* → pick an outfit → *I have a photo of the style I want* → add photos, paste the post's link, write what to change → *Continue to Design* → then the same steps as above. The photos, link and note appear on the order page and the Production board.
- **Make it:** Business dashboard → Orders → open the order → click *Mark cutting done*, then sewing, embroidery, fitting and quality control.
- **Pay the balance:** back in the Customer app, open the order and click *Pay balance*. Then confirm it in Business → Payments.
- **Deliver it:** in the order page, click *Dispatch order*, then move the parcel along until it's *Delivered*.
- **Review it:** in the Customer app, open the order and click *Leave a Review*.
- **Sell fabric:** Fabric sellers → *Create your seller profile* → add a fabric with some photos. Then Business dashboard → *Fabric Sellers* → *Approve*. It now shows in the customer app's Fabric Marketplace (🧶 Fabrics). When a customer orders an outfit in it, the order appears in the seller's *Orders* tab.

## Where is my data saved?

**Live (signed in):** in Supabase, so it's the same on every phone and laptop. Photos go to Supabase Storage: fabric photos and seller logos in public buckets, customers' style photos and chat photos in private buckets that only the customer and the Nebeda Threads team can open. Photos are shrunk before uploading (fabric photos to 1200 pixels, style photos to 1280, logos to 320) — a 1–2 MB phone photo becomes about 150–250 KB. The app checks for changes made on other devices whenever you move between pages, and every 45 seconds. An order that's half-way through (before the deposit) is kept on that device until it's paid for.

Who can do what is decided by the database, not by the browser (see `supabase/setup.sql`):

| Person | How they get an account | What they can do |
|---|---|---|
| Customer | Creates one: *I want outfits made* | Their own profile, measurements, orders, chats and payments. Payments always start as *awaiting confirmation*. They can never set yards or prices: the tailor sends the quote and the database works it out. They can't move production stages or mark anything paid, and can only see their own chats and chat photos |
| Fabric seller | Creates one: *I sell fabric* | Their own shop and fabrics. New or changed fabrics wait for approval; they can't approve their own. They see the orders that use their fabric (customer's first name only) |
| Nebeda Threads staff | The owner adds their email in Tailor Team → *Team logins*; they then create an account with that email | The Business dashboard: confirm payments, move production stages, manage everything |
| Owner / admin | Set once in the Supabase SQL Editor (see below) | Everything, plus adding and removing staff logins |

**Demo mode:** in this browser only — the data in **localStorage**, uploaded photos in **IndexedDB**. Click **Reset to sample data** at the bottom of the page to start over, or **Leave demo** to go back to the sign-in page.

## Connecting to Supabase (one-off set-up)

The app is already pointed at the Wearvia Supabase project in `js/config.js` (the project URL and the *publishable* key — that key is meant to be public). **Never put the secret key in the app.**

1. **Run the database scripts.** Supabase → *SQL Editor* → *New query* → paste all of `supabase/setup.sql` → *Run*. It adds the missing tables, columns, security rules and photo buckets without touching your existing data. Then open another *New query*, paste all of `supabase/yards.sql` → *Run*. It switches the fabric columns from metres to yards and converts what's in them (money already charged doesn't change). Then do the same with `supabase/prices.sql`: it adds the price list (Business → Prices), makes the database price every customer order, and removes old unused metre functions. Then `supabase/tailor-quote.sql`: customers' orders become quote requests that the tailor prices, adds the order chat and its private `chat-photos` bucket, and ends with a report where every line should say OK. All four are safe to run again — but if you ever re-run setup.sql or prices.sql, run tailor-quote.sql straight after them.
2. **Set the sign-in addresses.** Supabase → *Authentication* → *URL Configuration*: set *Site URL* to the address where the app is published, and add the same address under *Redirect URLs*. The links in sign-up and password emails go there.
3. **Keep email confirmation on.** Supabase → *Authentication* → *Sign In / Providers* → *Email*: leave *Confirm email* switched on. Staff logins are only granted to confirmed emails.
4. **Make yourself the owner.** Open the app, create an account with your email (choose *I want outfits made*) and confirm it. Then in the SQL Editor run
   `select public.wearvia_make_owner('your-email@example.com');`
   Sign out and back in: the Business tab appears.

## Project files

```
wearvia/
├── index.html           The page layout
├── supabase/
│   ├── setup.sql        Run once in the Supabase SQL Editor: tables, security rules, photo buckets
│   ├── yards.sql        Run after setup.sql: switches fabric from metres to yards
│   ├── prices.sql       Run after yards.sql: the price list, and orders priced by the database
│   └── tailor-quote.sql Run after prices.sql: quote requests, the tailor's quote, and the order chat
├── css/
│   └── style.css        Colours, fonts and layout
└── js/
    ├── vendor/supabase.js The Supabase library (kept here so there's still nothing to install)
    ├── config.js        The Supabase project address and publishable key
    ├── data.js          Settings, the 16 order steps, sample data, saving/loading, helpers
    ├── cloud.js         Live mode: loading from and saving to Supabase, photo uploads
    ├── auth.js          Sign in, create an account, reset a password, demo mode
    ├── photos.js        Saves uploaded photos and logos, resizes them, draws the sample fabric photos
    ├── sellers-data.js  Every read and write for fabric sellers, their fabrics and orders; sample sellers
    ├── concept.js       Draws the design concept
    ├── marketplace.js   The customer Fabric Marketplace: photo grid, filters, fabric page
    ├── inspiration.js   Upload a Style: the customer's photos, link and note, and how the shop sees them
    ├── chat.js          The chat on every order: messages, photos, unread badges
    ├── seller.js        The Fabric Seller area
    ├── seller-fabrics.js Business tab: approve or hide sellers' fabrics
    ├── customer.js      Every customer app screen
    ├── dashboard.js     Business dashboard and Ask AI
    ├── quotes.js        Quote requests: chat, enter the yards, send the quote
    ├── orders.js        All orders, walk-in orders, the order page
    ├── production.js    Production board
    ├── team.js          Tailor team
    ├── customers.js     Customer profiles
    ├── measurements.js  Measurements
    ├── fabrics.js       Fabric inventory and suppliers
    ├── payments.js      Payments
    ├── prices.js        Prices (the price list)
    ├── weddings.js      Wedding and group orders
    ├── shop.js          Ready-to-wear
    ├── deliveries.js    Deliveries
    ├── invoices.js      Invoices
    └── app.js           Page addresses, tabs and start-up
```

After any change, the app calls `saveData()` and `renderAll()`. In demo mode `saveData()` writes to the browser; in live mode it hands over to `cloud.js`, which sends only what changed to Supabase and then reloads, so the screen shows what the database accepted.

## Customising

Open `js/data.js` and change the settings at the top:

```js
const APP_NAME = "Wearvia";          // the platform name
const SHOP_NAME = "Nebeda Threads";  // the first shop using it
const CURRENCY = "£";
const DEPOSIT_RATE = 0.6;            // 60% deposit
const DELIVERY_FEE = 15;
```

Tailoring prices (and the typical yards used as a starting point for walk-in orders), embroidery prices and colours are in the lists just below. Fabric is sold by the yard; the low-stock warning level is `LOW_STOCK_YARDS` (10). To change the look, edit the colours at the top of `css/style.css` (for example `--gold` and `--navy`).

If you change the sample data in `data.js`, click **Reset to sample data** in the app to load it.

## What's a stand-in for now

These parts work in the app but need real services before going live (see section 5 of the spec):

- **AI design concept:** drawn in the browser from the customer's choices. Swap `conceptSVG()` in `concept.js` for an image-generation API.
- **Payments:** a demo checkout. No money is taken; every payment made in the app waits for Nebeda Threads to confirm it. Stripe goes here — when it does, a Stripe webhook should mark payments as confirmed instead of a person.
- **Ask Wearvia AI:** answers a set of common questions from your data. It isn't a language model.
- **Delivery tracking:** tracking numbers are made up. Connect Royal Mail, DHL or Shippo.
- **Designers:** Nebeda Threads is the only designer for now, as the spec says for version 1. Everyone on the team can see every customer.

