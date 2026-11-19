/**
 * Magnetic Door Screen (Sierra Leone) — order receiver (Google Apps Script web app)
 *
 * Paste into the Apps Script editor, run setup() once, then deploy as a Web app
 * (Execute as: Me · Who has access: Anyone). Full instructions: backend/README.md
 *
 * Spreadsheet layout (your design is preserved exactly):
 *   Tab "Orders" — row 1: decorative title (never touched)
 *                 row 2: headers  Order ID | Name | phone | adresse | Quantité | Price  (never touched)
 *                 row 3+: orders, columns A–F only
 *   Hidden tab "_order_log" — internal metadata (date/time, request key, test/real, package, currency,
 *                 Orders row, state). Created by setup(); the only tab the script ever creates.
 *
 * Safety properties
 *  - Writes to SPREADSHEET_ID only. Only fills empty cells in A–F from row 3 down; never edits,
 *    clears or deletes existing rows, never changes formatting, never touches rows 1–2.
 *  - doPost never creates or restructures tabs.
 *  - If row 2 of "Orders" doesn't hold the 6 headers, nothing is written.
 *  - Prices are computed here; every field is re-validated here.
 *  - One script lock covers duplicate checks, ID generation and both writes.
 *  - Write-ahead log: the order is reserved in _order_log ("pending") BEFORE the Orders row is
 *    written, then marked "saved". A retry with the same request key completes or returns it —
 *    never a second row, even after a partial failure.
 *  - Real (non-test) orders are refused until goLive() is run. Test orders get a "TEST-" Order ID.
 */

// Destination spreadsheet: the ID is the long code in its URL (.../spreadsheets/d/<ID>/edit).
const SPREADSHEET_ID = '1uOJrcKl4MAHL4etcjf43StEsfjuotsAZmSzkZMc6Sq0';
const SHEET_NAME = 'Orders';
const HEADER_ROW = 2;      // row 1 is the decorative title
const FIRST_DATA_ROW = 3;  // orders start here
const LOG_SHEET_NAME = '_order_log';
const VERSION = '2026-11-19-header-row-2'; // shown by the health check, to confirm which code is deployed
const TIMEZONE = 'Africa/Freetown';
const CURRENCY = 'SLE';

const HEADERS = ['Order ID', 'Name', 'phone', 'adresse', 'Quantité', 'Price'];
const LOG_HEADERS = ['Order ID', 'Date & Time', 'Request Key', 'Mode', 'Package', 'Currency', 'Orders Row', 'State'];
const LOG = { id: 1, date: 2, key: 3, mode: 4, pkg: 5, currency: 6, row: 7, state: 8 }; // 1-based columns

// quantity -> package (must match PACKS in script.js). Only these packages are accepted.
const PACKAGES = {
  1: { label: '1 screen', price: 660 },
  2: { label: '2 screens', price: 1200 },
};
const DEDUPE_SECONDS = 6 * 60 * 60; // fast in-memory duplicate check; _order_log is the permanent one

/* ---------------- HTTP entry points ---------------- */

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return json_(handleOrder_(data));
  } catch (err) {
    console.error(err);
    const code = err && err.name === 'SheetConfigError' ? 'sheet_config' : 'server';
    return json_({ status: 'error', code: code, message: 'Order could not be saved.' });
  }
}

// Health check: open the /exec URL in a browser to confirm the deployment and its version.
function doGet() {
  return json_({ status: 'ok', service: 'magnetic-screen-orders', version: VERSION, live: isLive_() });
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
  // Refuse if the page showed a different price/currency (e.g. an old cached page).
  if (data.currency !== CURRENCY || Number(data.total) !== order.pkg.price) {
    return { status: 'error', code: 'price_changed', message: 'Price or currency does not match the current offer.' };
  }

  const cache = CacheService.getScriptCache();
  const cached = cache.get('k:' + key);
  if (cached) return JSON.parse(cached);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { status: 'error', code: 'busy', message: 'Server busy, try again.' };
  try {
    const t = sheets_();
    const result = saveOnce_(t, key, order, isTest);
    cache.put('k:' + key, JSON.stringify(result), DEDUPE_SECONDS);
    return result;
  } finally {
    lock.releaseLock();
  }
}

// Must be called while holding the script lock.
function saveOnce_(t, key, order, isTest) {
  const logRows = readRows_(t.log, 2, LOG_HEADERS.length);
  const existing = findLast_(logRows, LOG.key, key);

  if (existing && existing.row[LOG.state - 1] === 'saved') {
    return success_(existing.row[LOG.id - 1], order, isTest, Number(existing.row[LOG.row - 1]));
  }

  let orderId, logRowNum;
  if (existing) {
    // A previous attempt reserved this order but didn't finish (state "pending").
    orderId = String(existing.row[LOG.id - 1]);
    logRowNum = existing.rowNum;
    const found = findOrderRow_(t.orders, orderId);
    if (found) { // the Orders row was written; only the log update was lost
      markSaved_(t.log, logRowNum, found);
      return success_(orderId, order, isTest, found);
    }
  } else {
    // New order: reserve a unique ID in the log first (write-ahead).
    orderId = uniqueOrderId_(isTest, t, logRows);
    logRowNum = 2 + logRows.length;
    t.log.getRange(logRowNum, 1, 1, LOG_HEADERS.length).setValues([[
      orderId,
      Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
      key,
      isTest ? 'TEST' : 'LIVE',
      order.pkg.label,
      CURRENCY,
      '',
      'pending',
    ]]);
    SpreadsheetApp.flush();
  }

  // Fill A–F of the next free row (values only — formatting is left exactly as designed), then
  // confirm the write before marking the reservation saved.
  const r = nextFreeRow_(t.orders);
  const target = t.orders.getRange(r, 1, 1, HEADERS.length);
  const fmts = target.getNumberFormats()[0]; // read only: decides whether text needs the hidden apostrophe
  const text = (v, i, always) => (fmts[i] === '@' ? v : always ? asText_(v) : safeCell_(v));
  target.setValues([[
    orderId,
    text(order.name, 1, false),
    text(order.phone, 2, true),   // "+232…" must stay text, not become a number
    text(order.address, 3, false),
    order.qty,
    order.pkg.price,
  ]]);
  SpreadsheetApp.flush();
  if (t.orders.getRange(r, 1).getDisplayValue() !== orderId) throw new Error('Write verification failed');

  markSaved_(t.log, logRowNum, r);
  return success_(orderId, order, isTest, r);
}

function success_(orderId, order, isTest, row) {
  const res = { status: 'success', orderId: String(orderId), test: isTest, total: order.pkg.price, currency: CURRENCY };
  if (isTest) { res.tab = SHEET_NAME; res.row = row; } // location only for test orders, to make checking easy
  return res;
}

function markSaved_(log, logRowNum, ordersRow) {
  log.getRange(logRowNum, LOG.row, 1, 2).setValues([[String(ordersRow), 'saved']]);
  SpreadsheetApp.flush();
}

function validate_(d) {
  const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const name = clean(d.name, 80);
  const phone = clean(d.phone, 20).replace(/\s/g, '');
  const address = clean(d.address, 200);
  const qty = Number(d.quantity);
  const pkg = PACKAGES[qty];
  const errors = [];
  if (name.length < 2) errors.push('name');
  if (!/^\+232[2-9]\d{7}$/.test(phone)) errors.push('phone');
  if (address.length < 3) errors.push('address');
  if (!pkg) errors.push('quantity');
  return { name: name, phone: phone, address: address, qty: qty, pkg: pkg, errors: errors };
}

/* ---------------- Sheet helpers ---------------- */

function SheetConfigError_(message) {
  const e = new Error(message);
  e.name = 'SheetConfigError';
  return e;
}

function spreadsheet_() {
  try {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (err) {
    throw SheetConfigError_('Cannot open spreadsheet ' + SPREADSHEET_ID + ' (wrong ID or no access): ' + err.message);
  }
}

// Header comparison that tolerates case, extra spaces and accent encoding (é typed as one or two characters).
function norm_(s) {
  return String(s).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

// The header cells actually found in `row`, as displayed.
function headerCells_(sheet, row, headers) {
  if (sheet.getLastRow() < row) return [];
  return sheet.getRange(row, 1, 1, headers.length).getDisplayValues()[0];
}

function headersMatch_(sheet, row, headers) {
  const found = headerCells_(sheet, row, headers);
  return found.length === headers.length && found.every((h, i) => norm_(h) === norm_(headers[i]));
}

// Used by doPost: finds both tabs and checks their headers. Never creates or changes tabs.
function sheets_() {
  const ss = spreadsheet_();
  const orders = ss.getSheetByName(SHEET_NAME);
  const log = ss.getSheetByName(LOG_SHEET_NAME);
  if (!orders) throw SheetConfigError_('Missing tab "' + SHEET_NAME + '". Nothing was written.');
  if (!log) throw SheetConfigError_('Missing hidden tab "' + LOG_SHEET_NAME + '". Run setup() first. Nothing was written.');
  if (!headersMatch_(orders, HEADER_ROW, HEADERS)) {
    throw SheetConfigError_('Row ' + HEADER_ROW + ' of tab "' + SHEET_NAME + '" must hold: ' + HEADERS.join(' | ') +
      '. Found: ' + headerCells_(orders, HEADER_ROW, HEADERS).join(' | ') + '. Nothing was written.');
  }
  if (!headersMatch_(log, 1, LOG_HEADERS)) throw SheetConfigError_('Tab "' + LOG_SHEET_NAME + '" has unexpected headers. Nothing was written.');
  return { orders: orders, log: log };
}

// Display values of rows `from`..last row with content, columns 1..width. [] if none.
function readRows_(sheet, from, width) {
  const n = sheet.getLastRow() - from + 1;
  if (n < 1) return [];
  return sheet.getRange(from, 1, n, width).getDisplayValues();
}

function findLast_(rows, col, value) {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i][col - 1] === value) return { row: rows[i], rowNum: i + 2 };
  }
  return null;
}

// Row number in Orders whose Order ID (column A) equals orderId, or 0.
function findOrderRow_(orders, orderId) {
  const ids = readRows_(orders, FIRST_DATA_ROW, 1);
  for (let i = ids.length - 1; i >= 0; i--) if (ids[i][0] === orderId) return i + FIRST_DATA_ROW;
  return 0;
}

// First row (from row 3) after the last filled Order ID whose A–F cells are all empty and hold no
// formula. Formatting, checkboxes or content in other columns further down don't affect it, and a
// row with anything in A–F is skipped, never overwritten.
function nextFreeRow_(orders) {
  const n = orders.getLastRow() - FIRST_DATA_ROW + 1;
  if (n < 1) return FIRST_DATA_ROW;
  const range = orders.getRange(FIRST_DATA_ROW, 1, n, HEADERS.length);
  const values = range.getDisplayValues();
  const formulas = range.getFormulas();
  const used = (i) => values[i].some((c) => c !== '') || formulas[i].some((f) => f !== '');
  let last = -1;
  values.forEach((row, i) => { if (row[0] !== '') last = i; });
  let i = last + 1;
  while (i < n && used(i)) i++;
  return FIRST_DATA_ROW + i;
}

// MS-YYMMDD-NNNN (live) / TEST-YYMMDD-NNNN (test). Skips any ID already in Orders or the log,
// so a counter reset can never produce a duplicate. Called while holding the script lock.
function uniqueOrderId_(isTest, t, logRows) {
  const used = {};
  logRows.forEach((r) => { used[r[0]] = true; });
  readRows_(t.orders, FIRST_DATA_ROW, 1).forEach((r) => { used[r[0]] = true; });
  const props = PropertiesService.getScriptProperties();
  let seq = Number(props.getProperty('ORDER_SEQ') || '0');
  const day = Utilities.formatDate(new Date(), TIMEZONE, 'yyMMdd');
  let id;
  do {
    seq++;
    id = (isTest ? 'TEST-' : 'MS-') + day + '-' + ('000' + seq).slice(-4);
  } while (used[id]);
  props.setProperty('ORDER_SEQ', String(seq));
  return id;
}

// Text starting with = + - @ would be treated as a formula; prefix with an apostrophe (hidden in Sheets).
function safeCell_(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

// Force plain text without changing the cell's number format (the apostrophe is hidden in Sheets).
function asText_(v) {
  return "'" + v;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function isLive_() {
  return PropertiesService.getScriptProperties().getProperty('LIVE') === 'true';
}

/* ---------------- Admin functions (run from the editor) ---------------- */

// Run once (safe to run again). Checks the existing "Orders" tab WITHOUT changing it, and creates the
// hidden "_order_log" tab if it's missing. Never creates "Orders", never writes to rows 1–2.
function setup() {
  const ss = spreadsheet_();
  const orders = ss.getSheetByName(SHEET_NAME);
  if (!orders) throw new Error('No tab named "' + SHEET_NAME + '" in "' + ss.getName() + '". Nothing was changed.');
  if (!headersMatch_(orders, HEADER_ROW, HEADERS)) {
    throw new Error('Row ' + HEADER_ROW + ' of "' + SHEET_NAME + '" must hold: ' + HEADERS.join(' | ') +
      '. Found: ' + headerCells_(orders, HEADER_ROW, HEADERS).join(' | ') + '. Nothing was changed.');
  }

  let log = ss.getSheetByName(LOG_SHEET_NAME);
  if (log && log.getLastRow() > 0 && !headersMatch_(log, 1, LOG_HEADERS)) {
    throw new Error('Tab "' + LOG_SHEET_NAME + '" exists with different headers. Rename or remove it yourself, then run setup() again.');
  }
  if (!log) log = ss.insertSheet(LOG_SHEET_NAME);
  if (log.getLastRow() === 0) {
    log.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
    log.setFrozenRows(1);
  }
  log.hideSheet();

  const existing = readRows_(orders, FIRST_DATA_ROW, 1).filter((r) => r[0] !== '').length;
  console.log('OK — version ' + VERSION + '. Spreadsheet "' + ss.getName() + '" (' + ss.getUrl() + '). ' +
    'Tab "' + SHEET_NAME + '" (gid ' + orders.getSheetId() + '): headers found in row ' + HEADER_ROW + ', ' +
    existing + ' existing orders, next order goes to row ' + nextFreeRow_(orders) + '. ' +
    'Hidden log tab "' + LOG_SHEET_NAME + '": ' + Math.max(0, log.getLastRow() - 1) + ' entries. ' +
    'Live orders enabled: ' + isLive_());
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
