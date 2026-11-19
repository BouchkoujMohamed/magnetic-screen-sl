# Order backend — Google Sheets via Apps Script

Orders from the landing page are sent to a Google Apps Script web app. The script adds each order as a new row to an **Orders** tab in your spreadsheet. Your Google login and spreadsheet permissions never appear in the website code. The only thing the website knows is the web app's public URL, and that URL can do one thing: add an order that passes validation.

## What gets saved

One row per order, on the `Orders` tab. The script creates this tab, with these headers, the first time it runs:

| Order ID | Date & Time | Customer Name | Phone | Address | City | Package | Quantity | Total Price | Currency | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| MS-261120-0005 | 2026-11-20 14:05:12 | Aminata Kamara | +23276123456 | Lumley | Freetown | 2 screens | 2 | 1,200 | SLE | New |

- **Order ID** is `MS-YYMMDD-NNNN`, or `TEST-YYMMDD-NNNN` for test orders. The number counts up and is never reused.
- **Date & Time** is in Freetown time (Africa/Freetown).
- **Package and Total Price** are set by the script from the chosen quantity, so the browser can't change the price. 1 screen = SLE 660, 2 screens = SLE 1,200. Any other package is rejected. The page also sends the currency and total it showed the customer; if they don't match these prices (for example an old cached page still showing GNF), the order is refused with "prices have been updated, please refresh".
- **Currency** is `SLE`. Rows saved before the Sierra Leone switch keep their original `GNF` currency and amounts. The script never edits them.
- **Status** is `New` for real orders and `TEST` for test orders. You can change the status by hand later (for example to Confirmed or Delivered), and the script will never overwrite it.

The script only **adds** rows. It never edits or deletes existing rows, and it never touches your other tabs. If an `Orders` tab already exists with different headers, the script refuses to write and reports an error, so your data can't end up in the wrong columns.

## One-time setup (about 5 minutes)

You do these steps in your own Google account. Never share your password or any security code with anyone.

1. **Open the spreadsheet**, then go to **Extensions → Apps Script**. A new tab opens with a code editor.
2. **Paste the code:** delete everything in `Code.gs` in the editor, paste in the full contents of [`backend/Code.gs`](Code.gs), then click **💾 Save**. You can rename the project, for example to "Order receiver".
3. **Run setup and allow access:**
   1. In the toolbar's function menu, choose **`setup`** and click **▶ Run**.
   2. Google asks for permission. Click **Review permissions**, then choose your account.
   3. If you see "Google hasn't verified this app", click **Advanced → Go to Order receiver (unsafe)**. This warning appears for any script you write yourself.
   4. Click **Allow**. Google lists the permission as *see, edit, create and delete your spreadsheets*, which the script needs to add rows. The script itself only opens this one spreadsheet.
   5. The log at the bottom should say `OK — orders will be appended to tab "Orders"`, and a new **Orders** tab appears in your sheet.
4. **Deploy as a web app:**
   1. Click **Deploy → New deployment**, then the ⚙️ gear icon, then **Web app**.
   2. Description: `Orders v1`.
   3. **Execute as: Me**. The script writes with your permission, so customers don't need a Google account.
   4. **Who has access: Anyone**. This is required so customers' browsers can send orders. "Anyone" lets people send an order to the script; it doesn't let them open the sheet.
   5. Click **Deploy** and copy the **Web app URL**. It looks like `https://script.google.com/macros/s/AKfy…/exec`.
5. **Check it works:** open that URL in your browser. You should see `{"status":"ok","service":"magnetic-screen-orders","live":false}`.
6. **Send the URL to me**, or paste it yourself into `script.js` as `ORDER_ENDPOINT`.

## Test mode, then live

Real orders need **two switches**. That way they can't start by accident.

| | Website (`script.js`) | Apps Script |
|---|---|---|
| Test (default) | `ORDER_MODE = "test"` → orders are sent marked as tests and the page shows a "Test mode" notice | Accepts test orders and saves them with Status `TEST`. Refuses real orders. |
| Live | `ORDER_MODE = "live"` → real orders, no notice | Run **`goLive()`** once in the editor (function menu → `goLive` → ▶ Run) |

To stop real orders at any time without redeploying, run **`goTestOnly()`**. The website will then tell customers "Online ordering is not open yet".

## If you change Code.gs later

Go to **Deploy → Manage deployments → ✏️ Edit**, set **Version → New version**, then **Deploy**. The URL stays the same. If you create a *new* deployment instead, you get a new URL that has to go into `script.js`.

## Migrating the live deployment to Sierra Leone (GNF → SLE)

The deployed web app still runs the **old Guinea version** (GNF prices, +224 phones). Saving new code in the editor does **not** change a deployment: each deployment is pinned to a saved version. Until you complete step 4, the deployed script will reject orders from the new page, because the +232 numbers fail its phone check. It shows the customer an error and writes nothing.

1. **Back up the old code:** in Apps Script, copy the current `Code.gs` into a new file named `Code_GNF_backup.gs`, and comment the whole file out (select all, then Ctrl+/) so its functions don't clash.
2. **Paste the new code:** replace `Code.gs` with the new version from this folder and click **Save**. Don't run `goLive`.
3. **Test on a separate URL first:** go to **Deploy → New deployment → Web app** (Execute as: Me · Who has access: Anyone). Name it `Orders SLE – test`. This creates a **new** URL. The old deployment keeps running the old version and is untouched.
   - Open the new URL: you should see `"live":false`.
   - Put the new URL in `script.js` (`ORDER_ENDPOINT`), keep `ORDER_MODE = "test"`, and send one 1-screen and one 2-screen test order. Each should appear in the **Orders** tab as `SLE`, with Status `TEST`. Older rows, including the GNF test order, stay as they are.
4. **After you approve, choose one of these:**
   - **Keep the new URL** (simplest): leave it in `script.js`, then archive the old deployment under **Manage deployments → Archive** so the old GNF prices can no longer be used.
   - **Keep the original URL:** go to **Manage deployments → ✏️ Edit** the original deployment, set **Version** to the new version, then **Deploy**. Put the original URL back in `script.js`, then archive the `Orders SLE – test` deployment.
5. **To roll back,** edit the deployment and select the previous version (Manage deployments keeps every version).

Shared between deployments: the `ORDER_SEQ` counter, the `LIVE` switch and the duplicate-request memory are stored on the script, not per deployment. Order numbers keep counting up, and real orders stay locked until `goLive()` is run.

## Protections built in

- **Server checks:** the script checks every field again: name 2–80 characters, a `+232` phone number followed by 8 digits (first digit 2–9), city at least 2 characters, address 3–200 characters, a quantity of 1 or 2, and a currency and total matching the current SLE price. If anything is invalid, the script rejects the order, writes nothing, and the page highlights the field.
- **Duplicate protection:** the page disables the button while sending, and each order carries a unique request key. If the same order arrives twice, for example after a retry on a bad connection, the script returns the original order ID instead of adding a second row. It remembers these keys for 6 hours.
- **One at a time:** a lock makes the script handle simultaneous orders one after another.
- **Confirmed before success:** the script reads the new row back before replying. The customer sees "Thank you" only after that confirmation, and sees an error message otherwise.
- **Spam filter:** a hidden field that bots fill in leads to the request being rejected.
- **Formula protection:** customer text that starts with `=`, `+`, `-` or `@` is stored as plain text, so it can't run as a spreadsheet formula.

## Limits to know

- **Public URL:** anyone who finds the URL can send fake orders that pass validation. That's the same exposure any order form has. The confirmation call is your filter. If spam becomes a problem, ask about adding reCAPTCHA.
- **Speed:** Apps Script usually replies in 1–4 seconds. The page waits up to 25 seconds before showing an error.
- **Usage limits:** Google limits how much Apps Script can do per day and how many requests run at once (about 30). A normal landing page stays far below these limits; only a deliberate flood could reach them.
