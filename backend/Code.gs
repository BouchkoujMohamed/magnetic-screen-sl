/**
 * Magnetic Door Screen — order receiver (Google Apps Script web app)
 *
 * Paste this file into the spreadsheet's Apps Script editor (Extensions → Apps Script),
 * run setup() once, then deploy as a Web app (Execute as: Me · Who has access: Anyone).
 * Full instructions: backend/README.md
 *
 * Safety properties
 *  - Only ever APPENDS rows to the "Orders" tab; never edits or deletes existing rows or other tabs.
 *  - Prices are computed here from the package, never taken from the browser.
 *  - Every field is re-validated here; bad requests are rejected and nothing is written.
 *  - Duplicate submissions (same request key) return the original order instead of a new row.
 *  - Real (non-test) orders are refused until you run goLive(). Test orders are marked "TEST".
 */

const SHEET_NAME = 'Orders';
const TIMEZONE = 'Africa/Freetown';
const CURRENCY = 'SLE'; // Sierra Leonean Leone. Earlier rows in the sheet may be GNF (Guinea) and are left untouched.
const HEADERS = [
  'Order ID', 'Date & Time', 'Customer Name', 'Phone', 'Address', 'City',
  'Package', 'Quantity', 'Total Price', 'Currency', 'Status',
];
// quantity -> package (must match PACKS in script.js). Only these packages are accepted.
const PACKAGES = {
  1: { label: '1 screen', price: 660 },
  2: { label: '2 screens', price: 1200 },
};
const DEDUPE_SECONDS = 6 * 60 * 60; // remember request keys for 6 hours (CacheService max)

/* ---------------- HTTP entry points ---------------- */

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return json_(handleOrder_(data));
  } catch (err) {
    console.error(err);
    return json_({ status: 'error', code: 'server', message: 'Order could not be saved.' });
  }
}

// Health check: lets you open the /exec URL in a browser to confirm the deployment works.
function doGet() {
  return json_({ status: 'ok', service: 'magnetic-screen-orders', live: isLive_() });
}

/* ---------------- Order handling ---------------- */

function handleOrder_(data) {
  if (data.website) return { status: 'error', code: 'invalid', message: 'Rejected.' }; // honeypot

  const isTest = data.test === true;
  if (!isTest && !isLive_()) {
    return { status: 'error', code: 'not_live', message: 'Live orders are not enabled yet.' };
  }

  const key = String(data.key || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) return { status: 'error', code: 'invalid', message: 'Missing request key.' };

  const order = validate_(data);
  if (order.errors.length) {
    return { status: 'error', code: 'invalid', fields: order.errors, message: 'Invalid fields: ' + order.errors.join(', ') };
  }
  // The price is always computed here. If the page sent a currency/total that differs (e.g. an old
  // cached page still showing GNF prices), refuse the order instead of saving it at a price the
  // customer didn't see.
  if (data.currency !== CURRENCY || Number(data.total) !== order.pkg.price) {
    return { status: 'error', code: 'price_changed', message: 'Price or currency does not match the current offer.' };
  }

  const cache = CacheService.getScriptCache();
  const seen = cache.get('k:' + key);
  if (seen) return JSON.parse(seen); // duplicate submission → same answer, no new row

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { status: 'error', code: 'busy', message: 'Server busy, try again.' };
  try {
    const again = cache.get('k:' + key); // another request with this key may have finished while we waited
    if (again) return JSON.parse(again);

    const sheet = ordersSheet_();
    const now = new Date();
    const orderId = nextOrderId_(isTest, now);
    const row = [
      orderId,
      Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
      safeCell_(order.name),
      order.phone,            // already validated: +232 + 8 digits
      safeCell_(order.address),
      safeCell_(order.city),
      order.pkg.label,
      order.qty,
      order.pkg.price,
      CURRENCY,
      isTest ? 'TEST' : 'New',
    ];

    const r = sheet.getLastRow() + 1;
    const range = sheet.getRange(r, 1, 1, HEADERS.length);
    range.setNumberFormats([['@', '@', '@', '@', '@', '@', '@', '0', '#,##0', '@', '@']]);
    range.setValues([row]);
    SpreadsheetApp.flush();

    // Confirm the row really landed before telling the customer it's saved.
    if (sheet.getRange(r, 1).getDisplayValue() !== orderId) throw new Error('Write verification failed');

    const result = { status: 'success', orderId: orderId, test: isTest, total: order.pkg.price, currency: CURRENCY };
    cache.put('k:' + key, JSON.stringify(result), DEDUPE_SECONDS);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function validate_(d) {
  const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const name = clean(d.name, 80);
  const phone = clean(d.phone, 20).replace(/\s/g, '');
  const city = clean(d.city, 60);
  const address = clean(d.address, 200);
  const qty = Number(d.quantity);
  const pkg = PACKAGES[qty];
  const errors = [];
  if (name.length < 2) errors.push('name');
  if (!/^\+232[2-9]\d{7}$/.test(phone)) errors.push('phone');
  if (city.length < 2) errors.push('city');
  if (address.length < 3) errors.push('address');
  if (!pkg) errors.push('quantity');
  return { name: name, phone: phone, city: city, address: address, qty: qty, pkg: pkg, errors: errors };
}

/* ---------------- Sheet helpers ---------------- */

// Returns the Orders tab, creating it (with headers) if missing.
// Refuses to write if the tab exists with different headers, so existing data is never misaligned.
function ordersSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return sheet;
  }
  const current = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
  if (current.join('|') !== HEADERS.join('|')) {
    throw new Error('The "' + SHEET_NAME + '" tab has unexpected headers: ' + current.join(', ') +
      '. Expected: ' + HEADERS.join(', ') + '. Nothing was written.');
  }
  return sheet;
}

// MS-YYMMDD-0001 (live) / TEST-YYMMDD-0001 (test). Counter is global and never reused.
function nextOrderId_(isTest, now) {
  const props = PropertiesService.getScriptProperties();
  const seq = Number(props.getProperty('ORDER_SEQ') || '0') + 1;
  props.setProperty('ORDER_SEQ', String(seq));
  return (isTest ? 'TEST-' : 'MS-') + Utilities.formatDate(now, TIMEZONE, 'yyMMdd') + '-' + ('000' + seq).slice(-4);
}

// Text starting with = + - @ would be treated as a formula; prefix with an apostrophe (hidden in Sheets).
function safeCell_(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function isLive_() {
  return PropertiesService.getScriptProperties().getProperty('LIVE') === 'true';
}

/* ---------------- Admin functions (run from the editor) ---------------- */

// Run once: authorizes the script and creates/checks the Orders tab. Safe to run again.
function setup() {
  const sheet = ordersSheet_();
  console.log('OK — orders will be appended to tab "' + sheet.getName() + '" (currently ' + (sheet.getLastRow() - 1) +
    ' order rows). Live orders enabled: ' + isLive_());
}

// Accept real customer orders. Run only after the integration is approved.
function goLive() {
  PropertiesService.getScriptProperties().setProperty('LIVE', 'true');
  console.log('Live orders ENABLED.');
}

// Back to test-only: real orders are refused, test orders still accepted.
function goTestOnly() {
  PropertiesService.getScriptProperties().setProperty('LIVE', 'false');
  console.log('Live orders DISABLED (test orders only).');
}
