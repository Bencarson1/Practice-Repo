# Wearvia

Wearvia is one web app for bespoke and ready-to-wear fashion:

- **Customers** design an outfit, see a design concept, save their measurements, buy fabric, get an instant quote, pay a deposit, track production and leave a review.
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

Use the switch at the top right to move between the **Customer app**, the **Fabric sellers** area and the **Business dashboard**.

## The order steps

Every order follows these 16 steps, in this order (from the spec):

| # | Step | Where it happens |
|---|------|------------------|
| 1 | Customer chooses outfit type and design options | Customer app → outfit picker, then Design |
| 2 | AI design concept — approve or regenerate | Customer app → AI Design Concept |
| 3 | Measurements saved to the customer's profile | Customer app → My Measurements (saved as this year's profile) |
| 4 | Fabric selected from the marketplace | Customer app → Fabric Marketplace (photo grid from independent sellers, live stock) |
| 5 | Fabric purchased — stock goes down | Customer app → Buy Fabric |
| 6 | Instant quotation | Customer app → Quotation (fabric + tailoring + embroidery + delivery) |
| 7 | Deposit paid (60%) | Customer app → Payment. This creates the order and its invoice |
| 8 | Tailor assigned | Automatic: the least busy person in each role |
| 9–13 | Cutting → Sewing → Embroidery → Fitting → Quality control | Business → Production or the order page |
| 14 | Balance paid | Customer pays in their order, or the shop records it in Payments. Orders can't move on until it's paid |
| 15 | Delivery | Business → Deliveries: dispatch with a courier, then move the parcel along to *Delivered* |
| 16 | Customer leaves a review | Customer app → order → Leave a Review (only after delivery) |

The app won't let anyone skip a step: for example, opening the payment page before buying fabric sends you back to the step you're on. If a customer changes their design after buying fabric, the fabric goes back into stock and they approve a new concept.

## What's inside

**Customer app**

| Screen | What it does |
|--------|--------------|
| Home | Start an order, explore the marketplace, or open the business dashboard |
| Outfit picker & Design | Agbada, Kaftan, Senator, Bubu, Two Piece, Dress, Wedding, Suit, Aso Ebi, Custom; colour, embroidery, sleeve, neck |
| Upload a Style | *I have a photo of the style I want*: up to 5 photos (Instagram, TikTok or Pinterest screenshots, or camera photos), the link to the post, and a note such as "same dress but longer sleeves and in green" |
| AI Design Concept | A drawing made from the customer's choices. *Regenerate* makes a new version. Uploaded style photos show above it as *Your inspiration* |
| Measurements | Chest, waist, shoulder, sleeve, trouser length, neck (plus hips and length), saved per year |
| Fabric Marketplace & Purchase | Photo grid of approved fabrics from every seller. Search, and filter by type, colour, price, seller and in-stock. Each fabric has a page with all its photos, description and seller |
| Quotation & Payment | Itemised quote; deposit by card, Apple Pay or bank transfer (demo, no real money) |
| My Orders & Tracking | All 16 steps, who is working on it, balance due, invoice and delivery tracking |
| Designers, Ready to Wear, Profile | Nebeda Threads' profile and reviews, the ready-to-wear shop, and the customer's details |

**Business dashboard**

| Tab | What it does |
|-----|--------------|
| Dashboard | Order count, revenue, estimated profit, pending payments, late orders, low stock, what's due soon, and *Ask Wearvia AI* (answers from your data) |
| Orders | Every order, live (📷 marks orders with style photos). Take walk-in orders. Open an order to move it along, assign staff, take payments and dispatch it. If the customer uploaded a style, the order page opens with *Customer's style — copy this*: the photos (tap for full size), their note and the link |
| Production | A board of every order by the last step it finished. Orders with style photos show the photos, note and link on their card so the tailors know what to copy |
| Tailor Team | Who is doing cutting, sewing, embroidery, finishing and QC, and what's waiting for them |
| Customers | Order history, spend, favourite colour, notes and measurement profiles |
| Measurements | Save and edit any customer's measurements |
| Fabric Inventory | Live stock, low-stock warnings, restocking, new fabrics and suppliers |
| Fabric Sellers | Approve sellers' fabrics or hide them (with a reason the seller sees), and see every seller's shop, fabrics and sales |
| Payments | Record payments, see balances and payment history |
| Wedding Orders | One event with many people, each with their own outfit and status |
| Ready to Wear | Items, stock and sales |
| Deliveries | Dispatch orders and update courier tracking |
| Invoices | Made automatically for every order; download (print to PDF) or share |

**Fabric sellers** (the *Fabric sellers* switch at the top)

| Tab | What it does |
|-----|--------------|
| Sell on Wearvia | Create a seller profile, or sign in as an existing shop (demo — no passwords yet) |
| My fabrics | The seller's stall: every fabric with its status (*Live*, *Waiting for approval*, *Hidden*, *Sold out*). Edit, mark sold out / back in stock, or delete |
| Add a fabric | Up to 5 photos (the first is the cover), name, type, colour, price per metre in £, metres in stock, smallest order and a description |
| Orders | Every order that used the seller's fabric: metres, price, who it's for (first name only) and where to send it. *Mark as sent* when it's posted |
| Shop profile | Shop name, location, phone, delivery time and logo |

How approval works: new fabrics wait for Nebeda Threads to approve them before customers see them. Changing a live fabric's photos, name, type, colour or description sends it back for a quick check; price and stock changes go live straight away. If Nebeda Threads hides a fabric, the seller sees the reason on their stall.

Sample customers, fabrics, orders, payments and fabric sellers load automatically so you can try everything straight away. Twelve sample sellers are included — four with full market stalls (Mama Titi Wax Prints, Kente Corner, Indigo Adire Studio and Lace Lounge), with one fabric waiting for approval, one hidden and one sold out. Their photos are drawn patterns, so you can replace them with real ones.

## Try it out

- **Place an order as a customer:** Customer app → *Start an Order* → pick an outfit → design it → *Generate AI Concept* → *Approve* → enter your name and measurements → pick a fabric → *Buy Fabric* → *Continue to Quotation* → *Proceed to Payment* → *Pay deposit*.
- **Order from a photo:** Customer app → *Start an Order* → pick an outfit → *I have a photo of the style I want* → add photos, paste the post's link, write what to change → *Continue to Design* → then the same steps as above. The photos, link and note appear on the order page and the Production board.
- **Make it:** Business dashboard → Orders → open your new order → click *Mark cutting done*, then sewing, embroidery, fitting and quality control.
- **Pay the balance:** back in the Customer app, open the order and click *Pay balance*.
- **Deliver it:** in the order page, click *Dispatch order*, then move the parcel along until it's *Delivered*.
- **Review it:** in the Customer app, open the order and click *Leave a Review*.
- **Sell fabric:** Fabric sellers → *Create your seller profile* → add a fabric with some photos. Then Business dashboard → *Fabric Sellers* → *Approve*. It now shows in the customer app's Fabric Marketplace (🧶 Fabrics). When a customer orders an outfit in it, the order appears in the seller's *Orders* tab.

## Where is my data saved?

Everything is saved in your browser: the data in **localStorage**, and uploaded photos and logos in **IndexedDB** (it holds far more than localStorage). Fabric photos are shrunk to at most 1200 pixels and customers' style photos to 1280 pixels, as JPEGs, before saving — a 1–2 MB phone photo becomes about 150–250 KB.

- Your changes are still there when you refresh or come back later.
- Data stays on your computer and browser only. It isn't shared with other devices or people.
- Click **Reset to sample data** at the bottom of the page to start over (this also removes uploaded photos).
- If you saved data with an earlier version, it's upgraded automatically: your own orders and fabrics are kept, and the sample sellers are added.

## Project files

```
wearvia/
├── index.html           The page layout
├── supabase/
│   └── schema.sql       Tables, photo buckets and access rules for when the data moves to Supabase
├── css/
│   └── style.css        Colours, fonts and layout
└── js/
    ├── data.js          Settings, the 16 order steps, sample data, saving/loading, helpers
    ├── photos.js        Saves uploaded photos and logos, resizes them, draws the sample fabric photos
    ├── sellers-data.js  Every read and write for fabric sellers, their fabrics and orders; sample sellers
    ├── concept.js       Draws the design concept
    ├── marketplace.js   The customer Fabric Marketplace: photo grid, filters, fabric page
    ├── inspiration.js   Upload a Style: the customer's photos, link and note, and how the shop sees them
    ├── seller.js        The Fabric Seller area
    ├── seller-fabrics.js Business tab: approve or hide sellers' fabrics
    ├── customer.js      Every customer app screen
    ├── dashboard.js     Business dashboard and Ask AI
    ├── orders.js        All orders, walk-in orders, the order page
    ├── production.js    Production board
    ├── team.js          Tailor team
    ├── customers.js     Customer profiles
    ├── measurements.js  Measurements
    ├── fabrics.js       Fabric inventory and suppliers
    ├── payments.js      Payments
    ├── weddings.js      Wedding and group orders
    ├── shop.js          Ready-to-wear
    ├── deliveries.js    Deliveries
    ├── invoices.js      Invoices
    └── app.js           Page addresses, tabs and start-up
```

After any change, the app saves the data and calls `renderAll()` to redraw the screen.

## Customising

Open `js/data.js` and change the settings at the top:

```js
const APP_NAME = "Wearvia";          // the platform name
const SHOP_NAME = "Nebeda Threads";  // the first shop using it
const CURRENCY = "£";
const DEPOSIT_RATE = 0.6;            // 60% deposit
const DELIVERY_FEE = 15;
```

Tailoring prices per outfit, embroidery prices and colours are in the lists just below. To change the look, edit the colours at the top of `css/style.css` (for example `--gold` and `--navy`).

If you change the sample data in `data.js`, click **Reset to sample data** in the app to load it.

## What's a stand-in for now

These parts work in the app but need real services before going live (see section 5 of the spec):

- **AI design concept:** drawn in the browser from the customer's choices. Swap `conceptSVG()` in `concept.js` for an image-generation API.
- **Payments:** a demo checkout. No money is taken. Stripe goes here.
- **Ask Wearvia AI:** answers a set of common questions from your data. It isn't a language model.
- **Data:** saved in one browser. Move it to Supabase or Firebase so staff and customers share it, and add logins. The profile page's "sign in as" menu and the sellers' "choose your shop" list are only for trying the demo.
- **Style photos on Supabase:** `supabase/schema.sql` also has `order_inspiration`, `order_style_photos` and a private `style-photos` bucket. Style photos are saved through the same `PhotoStore` (with the folder `"style"`, so their refs start `ph_style_`), and the link and note are on `order.inspiration`.
- **Fabric sellers on Supabase:** `supabase/schema.sql` has the tables (`fabric_sellers`, `fabrics`, `fabric_photos`, `fabric_orders`), two Storage buckets and access rules. All seller reads and writes are in `js/sellers-data.js`, and all photo saving is in `PhotoStore` in `js/photos.js`, so those two files are the only ones to change. Seller payouts need Stripe Connect.
- **Delivery tracking:** tracking numbers are made up. Connect Royal Mail, DHL or Shippo.
- **Designers:** Nebeda Threads is the only designer for now, as the spec says for version 1.
