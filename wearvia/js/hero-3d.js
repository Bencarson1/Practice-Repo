/*
 * NebedaHub 3D logo on the homepage hero.
 *
 * The 3D "N" is pre-rendered from 55 angles into one small sprite image
 * (assets/nebedahub-3d-spin.webp, ~230 KB), so there's no 3D library to
 * download. The page first shows a tiny still picture
 * (assets/nebedahub-3d-front.webp); the sprite loads only after everything
 * else has loaded, and never on Data Saver / 2G connections or when the
 * phone asks for reduced motion — those keep the still picture.
 *
 * Movement: one full turn when it appears, then it follows the mouse on
 * computers, or sways gently on its own on phones. Tapping it spins it again.
 */
(function () {
  "use strict";

  var SPRITE = "assets/nebedahub-3d-spin.webp";
  var COLS = 11, ROWS = 5;
  // The angle (in degrees) of each picture in the sprite, in order
  var ANGLES = [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120, 128,
    136, 144, 152, 160, 168, 176, 184, 192, 200, 208, 216, 224, 232, 240, 248, 256, 264, 272, 280, 288,
    296, 304, 312, 320, 324, 328, 332, 336, 340, 344, 348, 352, 356];
  var SPIN_MS = 1800;
  var MAX_TILT = 34;

  var spriteState = "idle"; // idle | loading | ready | failed
  var waiting = [];

  function stillOnly() {
    try {
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
      var c = navigator.connection;
      if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ""))) return true;
    } catch (e) { /* keep going */ }
    return false;
  }

  function whenPageIsIdle(fn) {
    var run = function () {
      if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 2500 });
      else setTimeout(fn, 600);
    };
    if (document.readyState === "complete") run();
    else window.addEventListener("load", run, { once: true });
  }

  function withSprite(fn) {
    if (spriteState === "ready") return fn();
    if (spriteState === "failed") return;
    waiting.push(fn);
    if (spriteState === "loading") return;
    spriteState = "loading";
    whenPageIsIdle(function () {
      var img = new Image();
      img.decoding = "async";
      img.onload = function () {
        var go = function () { spriteState = "ready"; waiting.splice(0).forEach(function (f) { f(); }); };
        if (img.decode) img.decode().then(go, go); else go();
      };
      img.onerror = function () { spriteState = "failed"; waiting = []; };
      img.src = SPRITE;
    });
  }

  function frameFor(angle) {
    var a = ((angle % 360) + 360) % 360, best = 0, bestGap = 999;
    for (var i = 0; i < ANGLES.length; i++) {
      var gap = Math.abs(ANGLES[i] - a);
      gap = Math.min(gap, 360 - gap);
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    return best;
  }

  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  function setUp(box) {
    box.setAttribute("data-ready", "1");
    if (stillOnly()) return;

    withSprite(function () {
      if (!box.isConnected) return;
      var face = document.createElement("div");
      face.className = "nh-hero-3d-face";
      face.style.backgroundImage = "url(" + SPRITE + ")";
      face.style.backgroundSize = (COLS * 100) + "% " + (ROWS * 100) + "%";
      box.appendChild(face);
      box.classList.add("is-live");

      var finePointer = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
      var angle = 0, target = 0, shown = -1;
      var spinFrom = performance.now(), spinning = true;
      var visible = true, raf = 0;

      function show(i) {
        if (i === shown) return;
        shown = i;
        var col = i % COLS, row = Math.floor(i / COLS);
        face.style.backgroundPosition = (col / (COLS - 1) * 100) + "% " + (row / (ROWS - 1) * 100) + "%";
      }

      function tick(now) {
        raf = 0;
        if (!box.isConnected) { stop(); return; }
        if (spinning) {
          var t = Math.min(1, (now - spinFrom) / SPIN_MS);
          angle = ease(t) * 360;
          if (t >= 1) { spinning = false; angle = 0; }
        } else {
          if (!finePointer) target = 16 * Math.sin(now / 1600);
          angle += (target - angle) * 0.08;
        }
        show(frameFor(angle));
        if (visible && !document.hidden) raf = requestAnimationFrame(tick);
      }
      function start() { if (!raf) raf = requestAnimationFrame(tick); }

      function onMove(e) {
        var r = box.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2);
        target = Math.max(-1, Math.min(1, dx)) * MAX_TILT;
        start();
      }
      function onVisibility() { if (!document.hidden) start(); }
      function stop() {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        if (finePointer) window.removeEventListener("pointermove", onMove);
        document.removeEventListener("visibilitychange", onVisibility);
        if (io) io.disconnect();
      }

      if (finePointer) window.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("visibilitychange", onVisibility);

      var io = null;
      if ("IntersectionObserver" in window) {
        io = new IntersectionObserver(function (entries) {
          visible = entries[0].isIntersecting;
          if (visible) start();
        });
        io.observe(box);
      }

      box.addEventListener("click", function () {
        if (spinning) return;
        spinning = true;
        spinFrom = performance.now() - (angle / 360) * SPIN_MS * 0.15;
        start();
      });

      start();
    });
  }

  function scan() {
    var boxes = document.querySelectorAll(".nh-hero-3d:not([data-ready])");
    for (var i = 0; i < boxes.length; i++) setUp(boxes[i]);
  }

  // The homepage is drawn by customer.js and redrawn when people move around,
  // so look for new hero logos whenever the page changes.
  var pending = false;
  new MutationObserver(function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; scan(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
  else scan();
})();
