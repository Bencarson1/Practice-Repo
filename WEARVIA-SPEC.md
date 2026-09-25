# Wearvia — App Specification

**Owner:** Benjamen Oyekan
**Product name:** Wearvia (formerly TailorFlow). Wearvia is the platform; Nebeda Threads is the first business using it.
**Reference prototype:** `wearvia-prototype.html` in this repository. Treat it as the visual and behavioural reference for screens, flow and wording.

---

## 1. What this is

One app that lets a customer design, order, pay for and track a bespoke or ready-to-wear outfit, and lets the designer (Nebeda Threads first, other designers later) run production, inventory and fabric sourcing from the same data. It also includes a fabric marketplace connecting designers to independent fabric suppliers.

## 2. Confirmed order lifecycle

Keep this sequence exactly:

1. Customer chooses outfit type and design options
2. AI generates a design concept; customer approves or regenerates
3. Measurements saved to the customer's profile
4. Fabric selected from the marketplace (multiple suppliers)
5. Fabric purchased (stock goes down)
6. Instant quotation generated
7. Deposit paid
8. Tailor assigned
9. Cutting
10. Sewing
11. Embroidery
12. Fitting
13. Quality control
14. Balance paid
15. Delivery
16. Customer leaves a review

## 3. Core screens

| # | Screen | Who uses it | Key behaviour |
|---|---|---|---|
| 1 | Home | Customer | Start order, browse marketplace, or (staff) open dashboard |
| 2 | Outfit picker | Customer | Agbada, Kaftan, Senator, Bubu, Two Piece, Dress, Wedding, Suit, Aso Ebi, Custom |
| 3 | Design & customise | Customer | Colour, embroidery, sleeve style, neck style |
| 4 | AI design concept | Customer | AI preview from selections; approve or regenerate |
| 5 | Measurements | Customer | Chest, waist, shoulder, sleeve, trouser length, neck; versioned by year |
| 6 | Fabric marketplace | Customer/Designer | Browse by type; supplier, price per yard, live stock, delivery time |
| 7 | Fabric purchase confirmation | Customer | Confirms quantity and supplier; reduces stock |
| 8 | Quotation | Customer | Itemised: fabric, tailoring, embroidery, delivery → total |
| 9 | Payment | Customer | Deposit now, balance later; card / Apple Pay / bank transfer |
| 10 | Order tracking | Customer | Visual pipeline through all production stages |
| 11 | Review | Customer | Star rating after delivery |
| 12 | Designer dashboard | Designer/Owner | Revenue, profit, order count, pending payments |
| 13 | All orders (live) | Designer | Every order across every customer, current stage |
| 14 | Tailor/production team | Designer | Staff assigned to cutting, sewing, embroidery, finishing, QC |
| 15 | Fabric inventory | Designer | Live stock per fabric, low-stock warnings |
| 16 | Customer profile | Designer | Order history, spend, preferences, notes |
| 17 | Wedding/group order | Designer | One order with many participants, each with own measurements/outfit/status |
| 18 | Ready-to-wear shop | Customer/Designer | Non-bespoke items for direct sale |
| 19 | Invoice | Customer/Designer | Auto-generated from the order; downloadable/shareable |
| 20 | Delivery tracking | Customer | Courier tracking number and status |
| 21 | Browse designers | Customer | Discover designers by rating, location, speciality |
| 22 | Designer profile (public) | Customer | Portfolio, rating, speciality; leads into that designer's order flow |

## 4. Data model (minimum viable)

```
customers
  id, name, email, phone, created_at
  measurement_profiles: [{ label: "2026", chest, waist, shoulder, sleeve, trouser_length, neck }]

designers
  id, business_name, location, rating, speciality_tags, commission_rate

orders
  id, customer_id, designer_id
  outfit_type, colour, embroidery, sleeve_style, neck_style
  concept_image_url
  measurement_profile_id
  fabric_id, fabric_supplier_id, fabric_yards, fabric_cost
  quote_total, deposit_amount, deposit_paid_at, balance_paid_at
  stage (tailor_assigned → cutting → sewing → embroidery → fitting →
         quality_control → balance_paid → delivered)
  assigned_staff: { cutting, sewing, embroidery, finishing, quality_control }
  review_rating, review_text
  created_at, updated_at

wedding_orders
  id, designer_id, event_name, event_date
  members: [{ role, name, order_id, status }]

fabrics
  id, name, category, price_per_yard, supplier_id, yards_available, min_order_yards

suppliers
  id, name, location, delivery_estimate, rating

invoices
  id, order_id, line_items, total, pdf_url, created_at

deliveries
  id, order_id, courier, tracking_number, status, eta
```

## 5. Recommended stack

- **Frontend:** responsive web app first; React Native later if app-store apps are needed
- **Backend/database:** Supabase or Firebase (auth, database and file storage together)
- **Payments:** Stripe (Connect, for future designer/supplier commission splits)
- **Notifications:** Twilio or WhatsApp Business API
- **AI design concepts:** an image-generation API; start simple
- **Delivery tracking:** Royal Mail/DHL APIs or an aggregator such as Shippo

## 6. Accounts needed before the real version

| Need | Where | Notes |
|---|---|---|
| Stripe (with Connect) | stripe.com | Deposits, balances, commission splits |
| Supabase or Firebase project | supabase.com / firebase.google.com | Free to start |
| Domain name | any registrar | e.g. wearvia.com |
| Apple Developer | developer.apple.com | $99/year, iOS only |
| Google Play Developer | play.google.com/console | $25 one-time |
| Twilio / WhatsApp Business | twilio.com | Order-status messages |

## 7. Out of scope for v1

- Public designer sign-up and discovery: start with Nebeda Threads as the only designer
- AI body measurement from photos
- Multi-designer commission payouts (needs Stripe Connect first)

## 8. Notes for whoever builds from this

- Currency is **£ (GBP)**.
- The prototype's `claude.use("db")` calls only work inside Claude artifacts. In this repo, replace them with a real database (Supabase/Firebase) or, for now, browser storage.
- The existing `wearvia/` folder (back-office dashboard) overlaps with screens 12–16; merge the best of both into one app rather than keeping two.
