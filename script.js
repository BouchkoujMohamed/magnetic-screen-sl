(() => {
  "use strict";

  /* ================= Configuration ================= */
  // Google Apps Script web app URL (ends in /exec) — see backend/README.md.
  // Empty = DEMO mode: nothing is sent anywhere.
  // This URL is public by design: it can only append validated orders; it grants no access to the sheet.
  const ORDER_ENDPOINT = "https://script.google.com/macros/s/AKfycbyPFaHU_1i9QvleDQf7Xkd25M2Ps6saGVqHWFds-Z5xOxHUUGKhHhNJl5F77DXPn7jI/exec";
  // "test": orders are saved with Status "TEST" and the page shows a test notice.
  // "live": real customer orders (also requires goLive() in the Apps Script). Switch only after approval.
  const ORDER_MODE = "live";
  const MODE = !ORDER_ENDPOINT ? "demo" : ORDER_MODE === "live" ? "live" : "test";
  const DEMO = MODE === "demo";

  const PRODUCT = "Magnetic Door Screen 100x210";
  const CONTENT_ID = "magnetic-door-screen";
  const CURRENCY = "SLE";
  // quantity delivered -> total price (SLE, Sierra Leone). Must match PACKAGES in backend/Code.gs.
  const PACKS = {
    1: { price: 660, label: "1 screen" },
    2: { price: 1200, label: "2 screens" },
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  /* ================= Meta Pixel ================= */
  // The base code in index.html loads the pixel and sends PageView. Everything here is wrapped so a
  // blocked or failing pixel (ad blockers, network) can never affect the page or the order form.
  // Privacy: only product, quantity, value and currency are sent — never name, phone or address.
  const pixel = (method, event, params, options) => {
    try {
      if (typeof window.fbq !== "function") return;
      if (options) window.fbq(method, event, params, options); else window.fbq(method, event, params);
    } catch (_) { /* ignore */ }
  };
  const productData = (qty) => ({
    content_name: PRODUCT,
    content_ids: [CONTENT_ID],
    content_type: "product",
    contents: [{ id: CONTENT_ID, quantity: qty }],
    num_items: qty,
    value: PACKS[qty].price,
    currency: CURRENCY,
  });
  // Purchase only for real orders the backend confirmed as saved (res.test === false), once per Order ID —
  // also across reloads in the same tab. A confirmed TEST order sends the custom event "TestPurchase"
  // instead, so test orders never count as Purchase conversions.
  const reportedOrders = new Set();
  const alreadyReported = (id) => {
    if (reportedOrders.has(id)) return true;
    try { if (sessionStorage.getItem("fbq_order_" + id)) return true; } catch (_) { /* storage blocked */ }
    return false;
  };
  const markReported = (id) => {
    reportedOrders.add(id);
    try { sessionStorage.setItem("fbq_order_" + id, "1"); } catch (_) { /* storage blocked */ }
  };
  const reportOrder = (res, qty) => {
    try {
      if (!res || res.status !== "success" || !res.orderId || alreadyReported(res.orderId)) return;
      markReported(res.orderId);
      const data = productData(qty);
      if (res.test === false && MODE === "live") pixel("track", "Purchase", data, { eventID: res.orderId });
      else if (MODE === "test") pixel("trackCustom", "TestPurchase", data, { eventID: res.orderId });
    } catch (_) { /* tracking must never affect the order */ }
  };

  document.documentElement.classList.add("js");
  const yr = $("#yr"); if (yr) yr.textContent = new Date().getFullYear();

  /* ================= Missing-image placeholders ================= */
  // If an original asset isn't in assets/img/, show a clearly labeled placeholder instead.
  const placeholder = (img) => {
    const w = img.getAttribute("width") || 400, h = img.getAttribute("height") || 300;
    const label = (img.dataset.ph || img.getAttribute("src")).replace(/[<&>"]/g, "");
    const fs = Math.max(10, Math.round(Math.min(w, h) / 24));
    const per = Math.max(12, Math.floor((w * 0.6) / (fs * 0.56)));
    const lines = label.match(new RegExp(".{1," + per + "}(\\s|$)|\\S+", "g")) || [label];
    const text = ["MISSING ASSET"].concat(lines).map((l, i) =>
      `<tspan x="50%" dy="${i ? 1.3 : 0}em"${i ? "" : ' font-weight="700"'}>${l.trim()}</tspan>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect width="100%" height="100%" fill="#eef2f9"/><rect x="4" y="4" width="${w - 8}" height="${h - 8}" fill="none" stroke="#9aa7c2" stroke-width="2" stroke-dasharray="8 6"/>` +
      `<text x="50%" y="${h / 2 - (lines.length * fs * 1.3) / 2}" font-family="Segoe UI,Arial,sans-serif" font-size="${fs}" fill="#5b6782" text-anchor="middle">${text}</text></svg>`;
    img.classList.add("ph");
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  };
  $$("img[data-ph]").forEach((img) => {
    const fail = () => { if (!img.classList.contains("ph")) placeholder(img); };
    img.addEventListener("error", fail, { once: true });
    if (img.complete && img.naturalWidth === 0 && img.getAttribute("src")) fail();
  });

  // ViewContent: once per page load (this script runs once).
  pixel("track", "ViewContent", productData(1));

  /* ================= Reveal on scroll ================= */
  const reveals = $$(".reveal");
  const showAll = () => reveals.forEach((el) => el.classList.add("in"));
  if (!("IntersectionObserver" in window) || document.visibilityState === "hidden") {
    showAll();
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target;
        const sibs = el.parentElement ? $$(":scope > .reveal", el.parentElement) : [];
        el.style.transitionDelay = Math.min(sibs.indexOf(el), 4) * 80 + "ms";
        el.classList.add("in");
        io.unobserve(el);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    reveals.forEach((el) => io.observe(el));
  }

  /* ================= Before / After ================= */
  const ba = $(".ba");
  if (ba) {
    const tabs = $$(".ba-switch button", ba);
    let touched = false;
    const set = (state) => {
      ba.dataset.state = state;
      tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.to === state)));
    };
    tabs.forEach((t) => t.addEventListener("click", () => { touched = true; set(t.dataset.to); }));
    // auto-toggle until the visitor interacts
    let timer = null;
    const auto = () => { timer = setInterval(() => { if (!touched) set(ba.dataset.state === "before" ? "after" : "before"); else clearInterval(timer); }, 3200); };
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((es, o) => { if (es[0].isIntersecting) { auto(); o.disconnect(); } }, { threshold: 0.4 }).observe(ba);
    }
  }

  /* ================= Door demo ================= */
  const door = $("#door");
  const demoBtn = $("#demoBtn");
  if (door) {
    let busy = false, loop = null, visible = false;
    const play = () => {
      if (busy) return;
      busy = true;
      door.classList.remove("snap");
      door.classList.add("open");
      setTimeout(() => {
        door.classList.remove("open");
        door.classList.add("snap");
        if (navigator.vibrate && demoBtn && demoBtn.dataset.user) navigator.vibrate(30);
        setTimeout(() => { door.classList.remove("snap"); busy = false; }, 1200);
      }, 1400);
    };
    demoBtn && demoBtn.addEventListener("click", () => { demoBtn.dataset.user = "1"; clearInterval(loop); loop = null; play(); });
    door.addEventListener("click", play);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((es) => {
        visible = es[0].isIntersecting;
        if (visible && !loop && !(demoBtn && demoBtn.dataset.user)) { play(); loop = setInterval(() => visible && play(), 4200); }
        if (!visible && loop) { clearInterval(loop); loop = null; }
      }, { threshold: 0.35 }).observe(door);
    }
  }

  /* ================= Offer + total ================= */
  const form = $("#orderForm");
  const totalVal = $("#totalVal");
  const dock = $("#dock");
  const currentQty = () => Number(($("input[name=pack]:checked", form) || {}).value || 2);
  const renderTotal = () => {
    const p = PACKS[currentQty()];
    totalVal.textContent = fmt(p.price);
    totalVal.classList.remove("bump"); void totalVal.offsetWidth; totalVal.classList.add("bump");
    if (dock) { $("small", dock).textContent = p.label.replace(/ \(.*\)/, ""); $("b", dock).textContent = "SLE " + fmt(p.price); }
  };
  $$("input[name=pack]", form).forEach((r) => r.addEventListener("change", renderTotal));

  // "Order" links: scroll to the form and focus the first field
  $$("[data-cta]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => { const n = $("#f-name"); n && n.focus({ preventScroll: true }); }, 650);
  }));

  // InitiateCheckout: once, when the customer actually starts typing their details. Clicking an
  // "Order" button (which only scrolls and focuses the form) doesn't count.
  let checkoutStarted = false;
  form.addEventListener("input", (e) => {
    if (checkoutStarted || !e.isTrusted || !e.target.closest(".fields") || e.target.name === "website") return;
    checkoutStarted = true;
    pixel("track", "InitiateCheckout", productData(currentQty()));
  });

  /* ================= Mobile dock ================= */
  // shown once the hero button is scrolled past, hidden while the form or final CTA is on screen
  if (dock) {
    const heroCta = $(".hero .cta-row"), finalSec = $(".final");
    const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; };
    let raf = 0;
    const upd = () => { raf = 0; dock.classList.toggle("show", heroCta.getBoundingClientRect().bottom < 0 && !onScreen(form) && !onScreen(finalSec)); };
    addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(upd); }, { passive: true });
    addEventListener("resize", upd);
  }

  /* ================= Validation ================= */
  const normPhone = (v) => {
    let d = String(v).replace(/\D/g, "");
    if (d.startsWith("00232")) d = d.slice(5);
    else if (d.startsWith("232") && d.length > 8) d = d.slice(3);
    else if (d.startsWith("0") && d.length === 9) d = d.slice(1); // local format 076 123 456
    return d;
  };
  const rules = {
    name: (v) => v.trim().length >= 2,
    phone: (v) => /^[2-9]\d{7}$/.test(normPhone(v)), // Sierra Leone: 8 digits after +232 (e.g. 76 123 456)
    address: (v) => v.trim().length >= 3,
  };
  const check = (input) => {
    const ok = rules[input.name](input.value);
    input.closest(".field").classList.toggle("bad", !ok);
    input.setAttribute("aria-invalid", String(!ok));
    return ok;
  };
  Object.keys(rules).forEach((k) => {
    const el = form.elements[k];
    el.addEventListener("blur", () => { if (el.value) check(el); });
    el.addEventListener("input", () => { if (el.closest(".field").classList.contains("bad")) check(el); });
  });

  /* ================= Submission ================= */
  const btn = $("#submitBtn");
  const msg = $("#formMsg");
  const NOTICES = {
    demo: ["Demo mode: orders are not sent anywhere.", "Demo mode — this order was not sent to any server."],
    test: ["Test mode: orders are saved to the sheet with a TEST- order number. Real orders are not enabled yet.", "Test mode — saved to the sheet with a TEST- order number."],
  };
  if (NOTICES[MODE]) {
    $("#demoNote").textContent = NOTICES[MODE][0]; $("#demoNote").hidden = false;
    $("#thxDemo").textContent = NOTICES[MODE][1]; $("#thxDemo").hidden = false;
  }

  let sent = false;      // true once an order is confirmed — the form cannot be sent again
  let inFlight = false;  // a request is pending — ignore extra clicks/taps
  let reqKey = "", reqSig = "";

  // One key per distinct order. A retry of the SAME details reuses the key, so if the first
  // attempt was actually saved (e.g. the reply was lost), the server returns that order instead of a duplicate.
  const newKey = () => {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const a = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => (a[i] = Math.random() * 256));
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  };

  class OrderError extends Error { constructor(code, fields) { super(code); this.code = code; this.fields = fields || []; } }

  const send = (payload) => {
    if (DEMO) {
      console.info("[DEMO] Order not sent. Payload:", payload);
      return new Promise((res) => setTimeout(() => res({ status: "success", orderId: "" }), 900));
    }
    // text/plain avoids a CORS preflight, which Apps Script doesn't support; the reply is readable JSON.
    const opts = { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload), redirect: "follow" };
    const ctrl = "AbortController" in window ? new AbortController() : null;
    const t = ctrl && setTimeout(() => ctrl.abort(), 25000);
    return fetch(ORDER_ENDPOINT, ctrl ? { ...opts, signal: ctrl.signal } : opts)
      .catch(() => { throw new OrderError("network"); })
      .then((r) => r.json().catch(() => { throw new OrderError("server"); }))
      .then((j) => {
        if (j && j.status === "success" && j.orderId) return j;
        throw new OrderError((j && j.code) || "server", j && j.fields);
      })
      .finally(() => t && clearTimeout(t));
  };

  const ERRORS = {
    network: "We couldn't confirm your order. Please check your internet connection and try again.",
    invalid: "Some details look incorrect. Please check the highlighted fields and try again.",
    busy: "Our system is busy. Please wait a moment and try again.",
    not_live: "Online ordering is not open yet. Please try again later.",
    price_changed: "Our prices have been updated. Please refresh the page and place your order again.",
    test_closed: "This page has been updated. Please refresh the page and place your order again.",
    server: "Sorry, your order could not be saved. Please try again in a moment.",
    sheet_config: "Sorry, we can't take orders right now because of a technical problem. Please try again later.",
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (sent || inFlight) return;
    msg.textContent = "";
    if (form.elements.website.value) return; // honeypot: bot
    const bad = Object.keys(rules).filter((k) => !check(form.elements[k]));
    if (bad.length) { form.elements[bad[0]].focus(); return; }

    const qty = currentQty();
    const p = PACKS[qty];
    const phone = "+232" + normPhone(form.elements.phone.value);
    const name = form.elements.name.value.trim();
    const address = form.elements.address.value.trim();
    const sig = JSON.stringify([qty, name, phone, address]);
    if (sig !== reqSig) { reqSig = sig; reqKey = newKey(); }
    // Only what the server needs; it computes package label and price itself.
    // currency/total are sent only so the server can reject a stale page showing old prices.
    const payload = { key: reqKey, test: MODE !== "live", name, phone, address, quantity: qty, currency: CURRENCY, total: p.price, website: "" };

    inFlight = true;
    btn.disabled = true;
    btn.classList.add("loading");
    $(".lbl", btn).textContent = "Sending…";

    const done = (res) => {
      sent = true;
      btn.classList.remove("loading");
      $(".lbl", btn).textContent = "Order sent ✓";
      $("#thxName").textContent = name.split(" ")[0];
      $("#thxQty").textContent = p.label;
      $("#thxTotal").textContent = fmt(p.price);
      $("#thxPhone").textContent = phone;
      $("#thxId").textContent = res.orderId || "";
      $("#thxIdWrap").hidden = !res.orderId;
      $("#thanks").hidden = false;
      $("#thxClose").focus();
      reportOrder(res, qty); // Purchase (live) or TestPurchase (test) — only after the backend confirmed the save
    };

    send(payload).then(done).catch((err) => {
      const code = err instanceof OrderError ? err.code : "server";
      (err.fields || []).forEach((f) => { const el = form.elements[f]; if (el && rules[f]) { el.closest(".field").classList.add("bad"); el.setAttribute("aria-invalid", "true"); } });
      btn.disabled = false;
      btn.classList.remove("loading");
      $(".lbl", btn).textContent = "Confirm my order";
      msg.textContent = ERRORS[code] || ERRORS.server;
    }).finally(() => { inFlight = false; });
  });

  const closeThanks = () => { $("#thanks").hidden = true; };
  $("#thxClose").addEventListener("click", closeThanks);
  $("#thanks").addEventListener("click", (e) => { if (e.target.id === "thanks") closeThanks(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeThanks(); });
})();
