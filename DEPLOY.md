# Deploying to GitHub + Vercel

This is a static site: plain HTML/CSS/JS, with no build step, no server code on Vercel and no environment variables. Orders go straight from the visitor's browser to the Google Apps Script web app.

## What gets published

| In GitHub | On the website (Vercel) |
|---|---|
| Everything except the files listed in `.gitignore` | Only `index.html`, `styles.css`, `script.js` and `assets/img/`. `.vercelignore` keeps `backend/`, `tools/`, `assets/originals/` and the READMEs off the site. |

`vercel.json` adds these security headers:
- **Content-Security-Policy:** scripts can only load from this site, and the page can only send data to this site and Google Apps Script.
- **X-Frame-Options: DENY:** no other site can embed the page.
- **nosniff, Referrer-Policy and Permissions-Policy:** standard browser hardening.

It also sets caching for the images.

> If you add the Meta Pixel later, the Content-Security-Policy has to allow `connect.facebook.net` and `www.facebook.com`, or the pixel will be blocked.

## 1. Create the GitHub repository (you)

1. Sign in at github.com, then **New repository**.
2. Name it, for example `magnetic-screen-sl`.
3. Choose **Private** (recommended).
4. **Don't** add a README, .gitignore or license. The project already has them.
5. Click **Create repository** and copy its HTTPS address (`https://github.com/<you>/magnetic-screen-sl.git`).

## 2. Push the code (after you approve)

Run these from the project folder:

```
git init -b main
git add .
git status            # check the list: no .env, no exports, no .claude/
git commit -m "Magnetic screen landing page (Sierra Leone, test mode)"
git remote add origin https://github.com/<you>/magnetic-screen-sl.git
git push -u origin main
```

On the first push, Windows opens a GitHub sign-in window (Git Credential Manager). Sign in there yourself. Never paste a password or token into a chat.

## 3. Create the Vercel project (you)

1. Sign in at vercel.com with GitHub, then **Add New… → Project**.
2. Under **Import Git Repository**, choose `magnetic-screen-sl`. If it isn't listed, click **Adjust GitHub App Permissions** and grant access to **only this repository**.
3. Settings:
   - **Framework Preset:** Other
   - **Root Directory:** `./`
   - **Build Command:** leave empty, or turn on Override and leave the field blank
   - **Output Directory:** leave the default (the project root)
   - **Environment Variables:** none
4. Click **Deploy**. You get an address like `https://magnetic-screen-sl.vercel.app`.

Every later push to `main` redeploys the site automatically. Pushes to other branches get preview URLs.

## 4. Check the deployed site

- **Page:** it loads with all images, and the "Test mode" notice shows under the form.
- **Hidden files:** `https://<domain>/backend/Code.gs` and `/README.md` return **404**.
- **Test order:** send **one** order marked TEST from the live domain (name `TEST ORDER - Vercel`). It should appear in the Orders tab with a `TEST-` Order ID.
- **Phone check:** test on a real phone, both the layout and the sticky "Order" bar.

## 5. After the first deploy

- **Share preview image:** `og:image` must be a full web address for WhatsApp and Facebook previews. Set it to `https://<domain>/assets/img/og.jpg`, add `og:url`, then push.
- **Custom domain (optional):** Vercel → Project → Settings → Domains.

## 6. Going live (separate approval)

This only happens after you confirm the delivery and payment terms:

1. In Apps Script, run `goLive`.
2. In `script.js`, set `ORDER_MODE = "live"`, then commit and push. Vercel redeploys automatically.

To stop accepting real orders without redeploying, run `goTestOnly`.

## Order endpoint: security review

The Apps Script URL is public by design: anyone can see it in `script.js`. It gives no access to read or edit the sheet. It can only append an order that passes the server's checks.

**Client-side validation is not security.** The checks in the browser only help real customers fix typos. Anyone can skip them by calling the URL directly. All real enforcement happens in `Code.gs`:

| Risk | What protects against it | What's left |
|---|---|---|
| Malformed or edited requests | The server checks every field again: name length, `+232` plus 8 digits, address, and quantity 1 or 2. It sets prices itself and refuses a mismatched currency or total. | None for the format of the data. The server can't tell whether a person or phone number is real; your confirmation call does that. |
| Accidental double orders | The button is locked while sending. Each order carries a request key, and the server returns the original order for a repeated key (remembered for 6 hours). A lock means simultaneous orders can't collide. | A customer who reloads the page and orders again creates a new row. Usually that's legitimate; spot it by phone number. |
| Spam bots / floods | A hidden field catches naive bots, and every order is checked by the server. | **No rate limit and no CAPTCHA.** A script can create many fake but valid-looking rows. Possible upgrades (not implemented): a per-phone limit, such as 3 orders per number per day, in `Code.gs`, or Cloudflare Turnstile. |
| Spreadsheet formula injection | Text starting with `=`, `+`, `-` or `@` is stored as plain text. | None. |
| Fake "test" orders after going live | Their Order ID starts with `TEST-`, so they're easy to filter out. | Some noise in the sheet. This can be tightened so the script refuses test orders once live. |
| Data exposure | Customer data exists only in your Google Sheet, never on Vercel or GitHub. | Keep the sheet's sharing restricted. |
| Quotas | Google limits Apps Script, including how many requests can run at the same time (about 30). | A flood could slow down or block real orders. A rate limit would help. |
