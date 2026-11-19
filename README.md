# Magnetic Door Screen — English landing page

An English version of the French reference landing page (`zanvico.shop/mostik/`). Layout, styles and interactions match the original; only the text is translated. Plain HTML/CSS/JS, no build step.

```
index.html      page markup (English)
styles.css      the reference stylesheet, plus a few small additions at the end
script.js       interactions, pricing, validation, demo or real order submission
assets/img/     put the product images here (see "Images" below)
```

## Run locally

Any static server works. For example:

```
python -m http.server 5173
```

Then open http://localhost:5173. Opening `index.html` directly from disk also works.

## Features

- Scrolling top ticker with a Sierra Leone flag stripe (green, white, blue), plus a sticky header with an Order button
- Hero section: price, ticks, a pulsing call-to-action button, mosquitoes bouncing off the mesh, floating badges
- Before/After toggle that switches automatically every 3.2 s until the visitor clicks it
- Magnetic door animation: the panels open, a person walks through, then the panels snap shut with "SNAP!". It loops while the section is on screen, and the "Send someone through" button replays it.
- Benefit cards, a magnets and kit section, 3 installation steps, and a door-measuring box
- Pack selector (1 or 2 screens) that updates the total and the mobile dock live
- Order form validation: name (at least 2 characters), Sierra Leone phone number (+232 followed by 8 digits, e.g. 76 123 456; also accepts the local `0` prefix and `232…`/`00232…`) and delivery address, including the city (at least 3 characters). It also has a hidden honeypot field to catch bots.
- Thank-you modal (closes with Esc, a click on the backdrop, or the OK button)
- FAQ accordion using native `<details>` (first question open by default)
- Sticky mobile purchase bar. It appears after you scroll past the hero button and hides while the form or the final call-to-action is on screen. Hidden at 900 px and wider.
- Reveal-on-scroll animations, with support for reduced-motion settings

Market: **Sierra Leone**. Prices are in Leones (SLE): 1 screen = SLE 660, 2 screens = SLE 1,200. Phone numbers use +232, and payment is cash on delivery. The 4-screen package has no approved price, so it has been removed. Prices live in two places that must match: `PACKS` in `script.js` and `PACKAGES` in `backend/Code.gs`.

## Images

The original product images (12 `.webp` files + `og.jpg`) are in `assets/img/`. They were added with the owner's confirmation that reuse is authorized.

**Localized:** `aimants.webp` originally had French lettering baked in. That lettering was removed and redrawn in English: "STRONG MAGNETS", "Practical · Quiet · Effective", "QUICK OPENING!", "AUTOMATIC CLOSING!" and "QUIET CLOSING!". The photo, magnets, layout, colors and size (472×474) are unchanged. The untouched French original is kept at `assets/originals/aimants.fr.webp`. To regenerate the image, run `python tools/translate_aimants.py`, which needs Pillow and numpy plus the Windows fonts Segoe UI Bold, Monotype Corsiva and Bahnschrift. None of the other images contain French: their only text is measurements ("100cm", "210cm") and "CLICK!".

If an image file is ever missing, the page shows a labeled "MISSING ASSET" placeholder in its place instead of a broken image.

## Deploying

See [DEPLOY.md](DEPLOY.md) for the GitHub and Vercel steps, the post-deploy checks and the security review of the order endpoint.

## Order backend (Google Sheets)

Orders go to a Google Apps Script web app that adds each one as a row to the **Orders** tab of your Google Sheet. The script is in [`backend/Code.gs`](backend/Code.gs), and [`backend/README.md`](backend/README.md) has the setup and deployment steps, the columns, and the protections.

The page has three modes, set at the top of `script.js`:

- **Demo:** `ORDER_ENDPOINT` is empty, so nothing is sent anywhere.
- **Test** (`ORDER_MODE = "test"`, the default once a URL is set): orders are saved with a `TEST-` Order ID, and the page shows a "Test mode" notice.
- **Live** (`ORDER_MODE = "live"`, together with running `goLive()` in Apps Script): real customer orders are saved with an `MS-` Order ID.

The "Thank you" message appears only after the script confirms the row was saved. The message includes the order number.

## Differences from the reference

- Brand wordmark: "Moustiquaire**Magnétique**" became "Magnetic**Screen**", and the "CLAC !" sound became "SNAP!" (translations only).
- The Meta Pixel was removed. The `track()` calls are still in place and do nothing until you add your own pixel.
- On failure, the original still showed the thank-you message after 2.5 s. This version shows it only after the sheet confirms the order was saved, and otherwise shows an error.
- Orders go to your own Google Sheet (via Apps Script), not the reference site's backend. The thank-you message shows the order number. There is no separate City field: customers type the city as part of the delivery address.
