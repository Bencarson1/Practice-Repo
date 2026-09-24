# Wearvia

Wearvia is a starter web app for running a tailoring and fashion business from start to finish.
The first shop using it is **Nebeda Threads**.

It's plain HTML, CSS and JavaScript. There is nothing to install and no build step.

## What's inside

| Tab | What it does |
|-----|--------------|
| **Home** | Shows the shop name, quick totals, and the orders due soonest. |
| **Orders** | Create new orders and see every order with its stage and balance. |
| **Measurements** | Save and edit each customer's body measurements (in inches). |
| **Fabric Marketplace** | Browse fabrics, filter by type, and pick one for a new order. |
| **Production** | A board showing each order's stage: cutting → sewing → finishing → ready. |
| **Payments** | Record payments and see what each customer still owes. |

Sample customers, fabrics, orders and payments load automatically so you can try everything straight away.

## How to run it

### Option 1: Open the file (easiest)

1. Download or clone this repository.
2. Open the `wearvia` folder.
3. Double-click `index.html`. It opens in your web browser.

### Option 2: Run a small local web server

If you have Python installed, run this from the `wearvia` folder:

```bash
cd wearvia
python3 -m http.server 8000
```

Then go to <http://localhost:8000> in your browser. Press `Ctrl + C` in the terminal to stop the server.

## Try it out

- **Create an order:** Go to **Orders**, type a customer name (existing or new), pick a fabric, and click *Create order*. The fabric's stock goes down by the yards you used.
- **Choose a fabric:** In **Fabric Marketplace**, click *Choose for an order*. You'll jump to the order form with that fabric already selected.
- **Move an order through production:** In **Production**, click *Next ▶* to move an order from cutting to sewing, then finishing, then ready.
- **Take a payment:** In **Payments**, pick an order, enter an amount, and click *Record payment*. The balance updates everywhere.
- **Save measurements:** In **Measurements**, type a customer name and their sizes. Click *Edit* on any card to change them.

## Where is my data saved?

Everything is saved in your browser's **localStorage**. That means:

- Your changes are still there when you refresh or come back later.
- Data stays on your computer and browser only. It isn't shared with other devices or people.
- Click **Reset to sample data** at the bottom of the page to start over.

## Project files

```
wearvia/
├── index.html          The page layout and tabs
├── css/
│   └── style.css       All the colors and styling
└── js/
    ├── data.js         Settings, sample data, saving/loading, helper functions
    ├── home.js         Home screen
    ├── orders.js       Orders section
    ├── measurements.js Measurements section
    ├── fabrics.js      Fabric marketplace section
    ├── production.js   Production tracking section
    ├── payments.js     Payments section
    └── app.js          Tab switching and app start-up
```

Each section has its own file with a `render...()` function that draws that section. After any change, the app saves the data and calls `renderAll()` to redraw every section.

## Customizing

Open `js/data.js` and change the settings at the top:

```js
const SHOP_NAME = "Nebeda Threads"; // the name shown on the home screen
const CURRENCY = "$";               // e.g. "₦", "£", "€"
```

To change the colors, edit the variables at the top of `css/style.css` (for example `--brand`).

If you change the sample data in `data.js`, click **Reset to sample data** in the app to load it.

## Ideas for next steps

- Link measurements to each order so the tailor sees them on the production board.
- Add fabric suppliers and let customers buy fabrics online.
- Print receipts or invoices for payments.
- Move the data to a real database and add logins so staff can share it.
