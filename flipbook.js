"use strict";
var FB = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // runtime/games/flipbook.ts
  var flipbook_exports = {};
  __export(flipbook_exports, {
    FLIPBOOK_TEMPLATE: () => FLIPBOOK_TEMPLATE,
    createFlipbook: () => createFlipbook
  });

  // runtime/emitter.ts
  var map = /* @__PURE__ */ new Map();
  function emit(event, ...args) {
    const set = map.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(...args);
      } catch (e) {
        console.warn("[emit]", event, e);
      }
    }
  }

  // runtime/games/types.ts
  var num = (v, d) => typeof v === "number" && isFinite(v) ? v : d;
  var str = (v, d) => typeof v === "string" ? v : d;

  // runtime/games/flipbook.ts
  var bool = (v, d) => typeof v === "boolean" ? v : d;
  var clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
  var ease = (k) => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  var NO_ART = { src: "", ratio: 0 };
  function createFlipbook() {
    let ctx;
    let openings = 2;
    let hasCover = true;
    let bookScale = 1;
    let coverScale = 1;
    let anchorOn = "cover";
    let curl = 0.35;
    let pop = 0.06;
    let lastPageDelay = 1e3;
    let popDelay = 0;
    let pageAspect = 0.6;
    let flipMs = 750;
    let shade = false;
    let pageColor = "#fdf6e3";
    let coverColor = "#e3c04a";
    let cover = NO_ART;
    let lefts = [];
    let rights = [];
    let book;
    let underLeft;
    let underRight;
    let leaf;
    let leafFront;
    let leafBack;
    let fold;
    let foldArt;
    let frontShade;
    let backShade;
    let bh = 0;
    let sh = 0;
    let spineX = 0;
    let state = 0;
    let progress = 0;
    let started = false;
    let dragging = false;
    let animating = false;
    let done = false;
    let locked = false;
    let destroyed = false;
    let raf = 0;
    let popRaf = 0;
    const timers = [];
    let completeCb = null;
    let winCb = null;
    const totalStates = () => (hasCover ? 1 : 0) + openings;
    const isCover = (s) => hasCover && s === 0;
    const pageIdx = (s) => hasCover ? s - 1 : s;
    const hasNext = () => state + 1 < totalStates();
    const width = (a, hScale = 1) => bh * hScale * (a.ratio > 0 ? a.ratio : pageAspect);
    const coverW = () => width(cover, coverScale);
    const leftArt = (s) => isCover(s) ? NO_ART : lefts[pageIdx(s)] ?? NO_ART;
    const rightArt = (s) => isCover(s) ? cover : rights[pageIdx(s)] ?? NO_ART;
    const morph = (p) => clamp01((p - 0.5) * 2);
    const leafW = (s, p) => {
      const from = isCover(s) ? coverW() : width(rightArt(s));
      const to = s + 1 < totalStates() ? width(leftArt(s + 1)) : from;
      return from + (to - from) * morph(p);
    };
    const leafH = (s, p) => {
      const from = isCover(s) ? bh * coverScale : bh;
      return from + (bh - from) * morph(p);
    };
    const div = (css, tag) => {
      const el = document.createElement("div");
      el.style.cssText = css;
      el.dataset.fb = tag;
      return el;
    };
    const paint = (el, a, fallback) => {
      if (a.src) {
        el.style.backgroundColor = "transparent";
        el.style.backgroundImage = `url("${a.src}")`;
        el.style.backgroundRepeat = "no-repeat";
        el.style.backgroundSize = "100% 100%";
        el.style.backgroundPosition = "center";
      } else {
        el.style.backgroundImage = "none";
        el.style.backgroundColor = fallback;
      }
    };
    const crease = (w, h, f) => {
      const ax = w;
      const ay = h - f;
      const bx = w - f;
      const by = h;
      const cx = (ax + bx) / 2 + f * 0.16;
      const cy = (ay + by) / 2 + f * 0.16;
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const u = 1 - t;
        pts.push([u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by]);
      }
      return pts;
    };
    const box = (el, left, top, w, h) => {
      el.style.left = left + "px";
      el.style.top = top + "px";
      el.style.width = w + "px";
      el.style.height = h + "px";
    };
    const render = () => {
      if (!book) return;
      const s = state;
      const p = progress;
      const next = s + 1 < totalStates() ? s + 1 : -1;
      const y = sh / 2 - bh / 2;
      const showLeft = isCover(s) && next >= 0 ? leftArt(next) : leftArt(s);
      paint(underLeft, showLeft, pageColor);
      box(underLeft, spineX - width(showLeft), y, width(showLeft), bh);
      underLeft.style.opacity = isCover(s) ? String(clamp01((p - 0.5) * 2)) : "1";
      const showRight = next >= 0 ? rightArt(next) : rightArt(s);
      paint(underRight, showRight, pageColor);
      box(underRight, spineX, y, width(showRight), bh);
      underRight.style.opacity = isCover(s) ? String(clamp01(p * 5)) : "1";
      leaf.style.display = next >= 0 ? "block" : "none";
      const lw = leafW(s, p);
      const lh = leafH(s, p);
      box(leaf, spineX, sh / 2 - lh / 2, lw, lh);
      leaf.style.transform = `translateZ(${Math.sin(p * Math.PI) * bh * 0.012}px) rotateY(${-p * 180}deg)`;
      paint(leafFront, rightArt(s), isCover(s) ? coverColor : pageColor);
      if (next >= 0) paint(leafBack, leftArt(next), pageColor);
      const bend = isCover(s) ? 0 : curl * Math.sin(p * Math.PI);
      const foldPx = bend * Math.min(lw, lh) * 0.4;
      if (foldPx > 0.5 && next >= 0) {
        const poly = crease(lw, lh, foldPx).map(([x, y2]) => `${x.toFixed(1)}px ${y2.toFixed(1)}px`).join(", ");
        leafFront.style.clipPath = `polygon(0px 0px, ${lw.toFixed(1)}px 0px, ${poly}, 0px ${lh.toFixed(1)}px)`;
        fold.style.display = "block";
        fold.style.clipPath = `polygon(${poly}, ${lw.toFixed(1)}px ${lh.toFixed(1)}px)`;
        paint(foldArt, leftArt(next), pageColor);
        foldArt.style.width = lw + "px";
        foldArt.style.height = lh + "px";
        foldArt.style.transform = `matrix(0, 1, -1, 0, ${(lw + lh - foldPx).toFixed(2)}, ${(lh - foldPx).toFixed(2)})`;
      } else {
        leafFront.style.clipPath = "";
        fold.style.display = "none";
      }
      frontShade.style.opacity = shade ? String(0.05 + 0.45 * p) : "0";
      backShade.style.opacity = shade ? String(0.5 * (1 - p)) : "0";
    };
    const layout = () => {
      const w = ctx.root.clientWidth || 300;
      const h = ctx.root.clientHeight || 400;
      sh = h;
      bh = h * 0.98 * bookScale;
      const openShift = (width(rights[0] ?? NO_ART) - width(lefts[0] ?? NO_ART)) / 2;
      spineX = hasCover && anchorOn === "cover" ? w / 2 - coverW() / 2 : w / 2 - openShift;
      book.style.width = w + "px";
      book.style.height = h + "px";
      ctx.root.style.perspective = bh * 2 + "px";
      render();
    };
    const stopRaf = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const after = (ms, fn) => {
      timers.push(
        window.setTimeout(() => {
          if (!destroyed) fn();
        }, ms)
      );
    };
    const POP_MS = 620;
    const popAt = (u) => Math.sin(Math.PI * u * 3) * Math.pow(1 - u, 2) / 0.7162;
    const popLastPage = () => {
      if (pop <= 0 || !book) return;
      book.style.transformOrigin = `${spineX}px 50%`;
      const t0 = performance.now();
      const step = () => {
        if (destroyed || !book) return;
        const u = clamp01((performance.now() - t0) / POP_MS);
        book.style.transform = `scale(${(1 + pop * popAt(u)).toFixed(4)})`;
        if (u < 1) popRaf = requestAnimationFrame(step);
        else {
          popRaf = 0;
          book.style.transform = "scale(1)";
        }
      };
      popRaf = requestAnimationFrame(step);
    };
    const animateTo = (target, onDone) => {
      stopRaf();
      animating = true;
      const from = progress;
      const dur = Math.max(60, flipMs * Math.abs(target - from));
      const t0 = performance.now();
      const step = () => {
        if (destroyed) return;
        const k = clamp01((performance.now() - t0) / dur);
        progress = from + (target - from) * ease(k);
        render();
        if (k < 1) {
          raf = requestAnimationFrame(step);
        } else {
          raf = 0;
          animating = false;
          progress = target;
          render();
          onDone?.();
        }
      };
      raf = requestAnimationFrame(step);
    };
    const announce = () => emit("book-page", state + 1);
    const commit = () => {
      state = Math.min(state + 1, totalStates() - 1);
      progress = 0;
      render();
      announce();
      if (!hasNext() && !done) {
        done = true;
        locked = true;
        popDelay > 0 ? after(popDelay, popLastPage) : popLastPage();
        completeCb?.();
      }
    };
    const flipForward = () => {
      if (locked) return;
      const last = state + 2 >= totalStates();
      if (last) {
        locked = true;
        winCb?.();
      }
      ctx.sfx.play("flip");
      if (last) after(lastPageDelay, () => ctx.sfx.play("lastPage"));
      animateTo(1, commit);
    };
    const onDown = (e) => {
      if (locked || done || animating || !hasNext()) return;
      e.preventDefault();
      dragging = true;
      const startX = e.clientX;
      const travel = Math.max(1, leafW(state, 0) * 0.9);
      let dx = 0;
      try {
        ctx.root.setPointerCapture?.(e.pointerId);
      } catch {
      }
      const endDrag = () => {
        dragging = false;
        ctx.root.removeEventListener("pointermove", move);
        ctx.root.removeEventListener("pointerup", up);
        ctx.root.removeEventListener("pointercancel", up);
      };
      const move = (ev) => {
        if (!dragging) return;
        dx = startX - ev.clientX;
        progress = clamp01(dx / travel);
        render();
        if (progress >= 1) {
          endDrag();
          flipForward();
        }
      };
      const up = () => {
        if (!dragging) return;
        endDrag();
        if (dx > -6) flipForward();
        else animateTo(0);
      };
      ctx.root.addEventListener("pointermove", move);
      ctx.root.addEventListener("pointerup", up);
      ctx.root.addEventListener("pointercancel", up);
    };
    return {
      mount(c, params) {
        ctx = c;
        openings = Math.max(1, Math.min(6, Math.round(num(params.spreads, 2))));
        hasCover = bool(params.hasCover, true);
        if (!hasCover && openings < 2) openings = 2;
        bookScale = Math.max(0.2, Math.min(2, num(params.bookScale, 100) / 100));
        coverScale = Math.max(0.2, Math.min(1.5, num(params.coverScale, 100) / 100));
        anchorOn = params.anchor === "spread" ? "spread" : "cover";
        curl = Math.max(0, Math.min(1, num(params.pageCurl, 35) / 100));
        pop = Math.max(0, Math.min(0.4, num(params.lastPagePop, 6) / 100));
        lastPageDelay = Math.max(0, Math.min(5e3, num(params.lastPageDelayMs, 1e3)));
        popDelay = Math.max(0, Math.min(5e3, num(params.lastPagePopDelayMs, 0)));
        pageAspect = Math.max(0.2, Math.min(2, num(params.aspect, 0.6)));
        flipMs = Math.max(200, Math.min(2e3, num(params.flipMs, 750)));
        shade = bool(params.shade, false);
        pageColor = str(params.pageColor, "#fdf6e3");
        coverColor = str(params.coverColor, "#e3c04a");
        const pending = [];
        const art = (id) => {
          const key = typeof id === "string" ? id : "";
          const src = ctx.assets.src(key);
          const s = key ? ctx.assets.size?.(key) ?? null : null;
          const a = { src, ratio: s && s.w > 0 && s.h > 0 ? s.w / s.h : 0 };
          if (src && !a.ratio) pending.push(a);
          return a;
        };
        const list = (v) => Array.isArray(v) ? v : [];
        cover = art(params.cover);
        lefts = Array.from({ length: openings }, (_, i) => art(list(params.leftPages)[i]));
        rights = Array.from({ length: openings }, (_, i) => art(list(params.rightPages)[i]));
        if (typeof Image !== "undefined")
          for (const a of pending) {
            const probe = new Image();
            probe.onload = () => {
              if (destroyed || !probe.naturalWidth || !probe.naturalHeight) return;
              a.ratio = probe.naturalWidth / probe.naturalHeight;
              layout();
            };
            probe.src = a.src;
          }
        ctx.root.style.touchAction = "none";
        ctx.root.style.perspectiveOrigin = "50% 50%";
        ctx.root.style.overflow = "visible";
        const page = "position:absolute;box-sizing:border-box;background-repeat:no-repeat;";
        book = div("position:absolute;left:0;top:0;transform-style:preserve-3d;", "book");
        underLeft = div(page, "under-left");
        underRight = div(page, "under-right");
        leaf = div("position:absolute;transform-origin:left center;transform-style:preserve-3d;will-change:transform;", "leaf");
        const faceCss = "position:absolute;inset:0;backface-visibility:hidden;background-repeat:no-repeat;overflow:hidden;";
        leafFront = div(faceCss, "leaf-front");
        fold = div("position:absolute;inset:0;display:none;backface-visibility:hidden;overflow:hidden;", "fold");
        foldArt = div("position:absolute;left:0;top:0;transform-origin:0 0;background-repeat:no-repeat;", "fold-art");
        const foldShade = div(
          "position:absolute;inset:0;pointer-events:none;background:linear-gradient(135deg,rgba(0,0,0,.30),rgba(0,0,0,.06) 45%,rgba(255,255,255,.10));",
          "fold-shade"
        );
        fold.appendChild(foldArt);
        fold.appendChild(foldShade);
        leafBack = div(faceCss + "transform:rotateY(180deg);", "leaf-back");
        const shadeCss = "position:absolute;inset:0;pointer-events:none;";
        frontShade = div(shadeCss + "background:linear-gradient(270deg,rgba(0,0,0,.55),rgba(0,0,0,0) 55%);", "front-shade");
        backShade = div(shadeCss + "background:linear-gradient(90deg,rgba(0,0,0,.55),rgba(0,0,0,0) 55%);", "back-shade");
        leafFront.appendChild(frontShade);
        leafBack.appendChild(backShade);
        leaf.appendChild(leafFront);
        leaf.appendChild(leafBack);
        leaf.appendChild(fold);
        book.appendChild(underLeft);
        book.appendChild(underRight);
        book.appendChild(leaf);
        ctx.root.appendChild(book);
        layout();
      },
      start() {
        if (started) return;
        started = true;
        announce();
        ctx.root.addEventListener("pointerdown", onDown);
      },
      relayout: layout,
      getHint() {
        if (done || !hasNext()) return null;
        const r = leaf.getBoundingClientRect();
        const y = r.top + r.height * 0.62;
        const from = { x: r.right - r.width * 0.18, y };
        return { from, to: { x: r.left + r.width * 0.12, y }, kind: "slide" };
      },
      onComplete(cb) {
        completeCb = cb;
      },
      onWin(cb) {
        winCb = cb;
      },
      destroy() {
        destroyed = true;
        stopRaf();
        if (popRaf) cancelAnimationFrame(popRaf);
        popRaf = 0;
        for (const t of timers) window.clearTimeout(t);
        timers.length = 0;
        ctx.root.removeEventListener("pointerdown", onDown);
        ctx.root.style.perspective = "";
        ctx.root.innerHTML = "";
      }
    };
  }
  var FLIPBOOK_TEMPLATE = {
    id: "flipbook",
    label: "Flip the page (book)",
    paramFields: [
      { key: "spreads", label: "Page openings", type: "number", min: 1, max: 6, step: 1 },
      { key: "hasCover", label: "Start closed (cover)", type: "boolean" },
      { key: "bookScale", label: "Book size (%)", type: "number", min: 20, max: 200, step: 1 },
      { key: "coverScale", label: "Cover height (% of the pages)", type: "number", min: 20, max: 150, step: 1 },
      { key: "anchor", label: "Centre in the slot", type: "select", options: ["cover", "spread"] },
      { key: "aspect", label: "Page width \xF7 height (only if art size unknown)", type: "number", min: 0.2, max: 2, step: 0.01 },
      { key: "flipMs", label: "Flip duration (ms)", type: "number", min: 200, max: 2e3, step: 50 },
      { key: "pageCurl", label: "Page bend (%, 0 = stiff)", type: "number", min: 0, max: 100, step: 1 },
      { key: "lastPagePop", label: "Last-page bounce (%, 0 = none)", type: "number", min: 0, max: 40, step: 1 },
      { key: "lastPageDelayMs", label: "Last-page sound delay (ms)", type: "number", min: 0, max: 5e3, step: 50 },
      { key: "lastPagePopDelayMs", label: "Last-page bounce delay (ms)", type: "number", min: 0, max: 5e3, step: 50 },
      { key: "shade", label: "Add shading while turning", type: "boolean" },
      { key: "coverColor", label: "Cover colour (no art)", type: "color" },
      { key: "pageColor", label: "Page colour (no art)", type: "color" }
    ],
    assetSlots: [
      { key: "cover", label: "Closed book cover (sits on the right page)" },
      { key: "leftPages", label: "Left page", list: true, countParam: "spreads" },
      { key: "rightPages", label: "Right page", list: true, countParam: "spreads" }
    ],
    defaultParams: {
      spreads: 2,
      hasCover: true,
      bookScale: 100,
      coverScale: 100,
      anchor: "cover",
      aspect: 0.6,
      flipMs: 750,
      pageCurl: 35,
      lastPagePop: 6,
      lastPageDelayMs: 1e3,
      lastPagePopDelayMs: 0,
      shade: false,
      coverColor: "#e3c04a",
      pageColor: "#fdf6e3",
      cover: "",
      leftPages: [],
      rightPages: []
    },
    // Drag the outer edge of the right page in toward the spine.
    defaultHandguide: {
      nodes: [
        { x: 0.72, y: 0.62 },
        { x: 0.4, y: 0.62 }
      ],
      periodMs: 1700
    },
    create: createFlipbook
  };
  return __toCommonJS(flipbook_exports);
})();
