/* ============================================================
   CMF Buds — scroll-driven frame sequence
   ------------------------------------------------------------
   · preloads every frame (with a small worker pool)
   · scrubs the sequence from scroll position on a pinned canvas
   · lerps toward the target frame so scrubbing feels weighted
   · flips the text theme to match the frame behind it
   ============================================================ */

(() => {
  'use strict';

  const getAutoBasePath = () => {
    if (window.CMF_FRAMES_BASE) return window.CMF_FRAMES_BASE;
    try {
      const scripts = document.getElementsByTagName('script');
      for (let i = 0; i < scripts.length; i++) {
        const src = scripts[i].getAttribute('src') || '';
        if (src.includes('script.js')) {
          const idx = src.lastIndexOf('/');
          if (idx !== -1) return src.substring(0, idx + 1) + 'media/';
        }
      }
    } catch (e) {}
    return './media/';
  };

  const CONFIG = {
    /* where the frames live — auto-detected base path */
    basePath: getAutoBasePath(),
    prefix: 'ezgif-frame-',
    ext: '.jpg',
    total: 240,
    pad: 3,
    startAt: 1,

    /* scroll distance for the whole sequence, by viewport width */
    scrollVhDesktop: 620,
    scrollVhMobile: 460,
    mobileBreakpoint: 768,

    /* use every Nth frame on phones to keep memory in check */
    mobileStep: 2,

    /* must match the responsive breakpoint in styles.css, so the JS layout
       decisions and the CSS never disagree about what "mobile" means */
    mobileQuery: '(max-width: 860px)',

    /* 0..1 — higher snaps to the target frame faster */
    lerp: 0.15,

    /* parallel image requests — tuned down to prevent CDN 429 rate limiting */
    concurrency: 5,

    /* mean luminance of the lit region above/below these flips the text theme */
    lightAbove: 0.56,
    darkBelow: 0.44,

    /* what the baked-in black surround is repainted to */
    stageBackground: '#ffffff',
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function smoothstep(edge0, edge1, x) {
    if (edge1 <= edge0) return x < edge0 ? 0 : 1;
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  const fileName = (n) =>
    `${CONFIG.basePath}${CONFIG.prefix}${String(n).padStart(CONFIG.pad, '0')}${CONFIG.ext}`;

  /* ── DOM ───────────────────────────────────────────────── */
  const stage = document.getElementById('stage');
  const pin = document.getElementById('stage-pin');
  const canvas = document.getElementById('frame-canvas');
  /* React port: the buds-stage markup is gone — the loader is this script's
     only remaining job, so every stage touchpoint is optional now. */
  const ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null;

  const loader = document.getElementById('loader');
  const loaderBar = document.getElementById('loader-bar');
  const loaderPct = document.getElementById('loader-pct');
  const loaderHint = document.getElementById('loader-hint');

  const hudFill = document.getElementById('hud-fill');
  const hudNum = document.getElementById('hud-num');
  const hint = document.getElementById('hint');
  const nav = document.getElementById('nav');
  const hud = document.querySelector('.hud');
  const chip = document.getElementById('chip');
  const hotspotLayer = document.getElementById('hotspots');
  const legend = document.getElementById('legend');
  const navLinks = Array.from(document.querySelectorAll('.nav__links a[href^="#"]'));

  const state = {
    frames: [],
    numbers: [],
    luma: [],
    boxes: [],
    beats: [],
    hotspots: [],
    sections: [],
    activeSection: null,
    imgRect: null,
    mobile: false,
    progress: 0,
    current: 0,
    target: 0,
    lastIndex: -1,
    ready: false,
    /* the footage is shot on light backdrops, so light is the default and JS
       only ever adds the dark override */
    isLight: true,
    dpr: 1,
  };

  const reducedMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Build the frame list ──────────────────────────────── */
  function buildFrameList() {
    const isMobile = window.matchMedia(CONFIG.mobileQuery).matches || window.innerWidth < CONFIG.mobileBreakpoint;
    const step = isMobile ? CONFIG.mobileStep : 1;
    const numbers = [];
    for (let n = CONFIG.startAt; n < CONFIG.startAt + CONFIG.total; n += step) numbers.push(n);

    /* always land on the very last frame so the exploded view is the payoff */
    const last = CONFIG.startAt + CONFIG.total - 1;
    if (numbers[numbers.length - 1] !== last) numbers.push(last);

    state.numbers = numbers;
    state.frames = new Array(numbers.length).fill(null);
    state.luma = new Array(numbers.length).fill(1);
    state.boxes = new Array(numbers.length).fill(null);
  }

  /* ── Canvas sizing (device pixel aware) ────────────────── */
  function sizeCanvas() {
    if (!pin || !canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.dpr = dpr;
    const w = Math.max(1, Math.round(pin.clientWidth * dpr));
    const h = Math.max(1, Math.round(pin.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      state.lastIndex = -1;
    }
  }

  /* ── Per-frame analysis ─────────────────────────────────────
     One downscaled read gives us two things:
       · the "lit box" — where the actual image content is. The opening ~40
         frames have a black surround baked into the JPEG (frame 001 is only
         56% lit width), which we repaint to the stage colour so the main page
         reads as full-width white instead of pillarboxed.
       · the mean luminance INSIDE that box, which drives the text theme. The
         whole-frame average would say "dark" for frame 001 and pick light
         text — wrong, because what you actually see is a light backdrop. */
  const probe = document.createElement('canvas');
  probe.width = 240;
  probe.height = 135;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });

  function analyse(i, img) {
    const W = probe.width;
    const H = probe.height;
    try {
      probeCtx.drawImage(img, 0, 0, W, H);
      const d = probeCtx.getImageData(0, 0, W, H).data;
      const lum = (x, y) => {
        const p = (y * W + x) * 4;
        return (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255;
      };

      const THRESHOLD = 0.24;
      const midY = H >> 1;
      const midX = W >> 1;

      let left = -1, right = -1, top = -1, bottom = -1;
      for (let x = 0; x < W; x++) if (lum(x, midY) > THRESHOLD) { left = x; break; }
      if (left < 0) { state.luma[i] = 0; state.boxes[i] = null; return; }
      for (let x = W - 1; x >= 0; x--) if (lum(x, midY) > THRESHOLD) { right = x; break; }
      for (let y = 0; y < H; y++) if (lum(midX, y) > THRESHOLD) { top = y; break; }
      for (let y = H - 1; y >= 0; y--) if (lum(midX, y) > THRESHOLD) { bottom = y; break; }

      let sum = 0;
      let n = 0;
      for (let y = top; y <= bottom; y += 2) {
        for (let x = left; x <= right; x += 2) { sum += lum(x, y); n++; }
      }
      state.luma[i] = n ? sum / n : 1;

      const x0 = left / W;
      const x1 = (right + 1) / W;
      const y0 = top / H;
      const y1 = (bottom + 1) / H;
      const inset = x0 > 0.015 || x1 < 0.985 || y0 > 0.015 || y1 < 0.985;
      state.boxes[i] = inset ? { x0, y0, x1, y1 } : null;
    } catch (err) {
      state.luma[i] = 1;
      state.boxes[i] = null;
    }
  }

  /* paint the stage colour over everything except the lit box */
  function fillSurround(bx, by, bw, bh) {
    const cw = canvas.width;
    const ch = canvas.height;
    /* The hole must be INSET inside the lit box — expanding it would leave the
       panel's rim and anti-aliased fringe unfilled, which shows up as a dark
       line. Biting inwards is free: white over the light backdrop is invisible. */
    const grow = Math.min(12 * state.dpr, bw * 0.12, bh * 0.12);
    const hx = bx + grow;
    const hy = by + grow;
    const hw = Math.max(1, bw - grow * 2);
    const hh = Math.max(1, bh - grow * 2);
    const r = Math.max(0, Math.min(hw, hh) * 0.08);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(hx, hy, hw, hh, r);
    } else {
      ctx.rect(hx, hy, hw, hh);
    }
    ctx.fillStyle = CONFIG.stageBackground;
    ctx.fill('evenodd');
    ctx.restore();
  }

  /* ── Rendering ─────────────────────────────────────────── */
  function drawAt(index) {
    if (!canvas || !ctx) return;
    const total = state.frames.length;
    const i = clamp(index, 0, total - 1);

    let img = null;
    for (let k = Math.round(i); k >= 0; k--) {
      if (state.frames[k]) { img = state.frames[k]; break; }
    }
    if (!img) return;

    const cw = canvas.width;
    const ch = canvas.height;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const imgRatio = iw / ih;
    const boxRatio = cw / ch;

    /* cover fit */
    let dw, dh;
    if (imgRatio > boxRatio) { dh = ch; dw = ch * imgRatio; }
    else { dw = cw; dh = cw / imgRatio; }
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;

    /* How much of the frame a cover fit would keep. This is a wide, centred
       composition: on a portrait phone a cover fit keeps only ~30% of it and
       crops the earbuds away entirely, so fall back to a blurred contain fit.
       Mild mismatches (a 16:9 shot on a 16:10 screen) still just cover. */
    const coverKeep = Math.min(imgRatio / boxRatio, boxRatio / imgRatio);
    const useContain = coverKeep < 0.85;

    /* the rect the frame maps to 1:1 — callouts are pinned to it */
    let front;

    if (!useContain) {
      /* close enough in shape: straight cover */
      ctx.drawImage(img, dx, dy, dw, dh);
      front = { x: dx, y: dy, w: dw, h: dh };
    } else {
      /* aspect mismatch: blurred, dimmed backdrop then the whole frame on top */
      if ('filter' in ctx) {
        ctx.filter = `blur(${Math.round(28 * state.dpr)}px)`;
        ctx.drawImage(img, dx * 1.25, dy * 1.25, dw * 1.25, dh * 1.25);
        ctx.filter = 'none';
      } else {
        ctx.drawImage(img, dx, dy, dw, dh);
      }
      ctx.fillStyle = 'rgba(10, 10, 11, 0.62)';
      ctx.fillRect(0, 0, cw, ch);

      /* contain: fit the whole frame inside the box */
      let fw, fh;
      if (imgRatio > boxRatio) { fw = cw; fh = cw / imgRatio; }
      else { fh = ch; fw = ch * imgRatio; }
      const fx = (cw - fw) / 2;
      const fy = (ch - fh) / 2;
      ctx.drawImage(img, fx, fy, fw, fh);
      front = { x: fx, y: fy, w: fw, h: fh };
    }

    /* repaint any baked-in black surround to the stage colour, so the opening
       frames read as full-width white rather than pillarboxed */
    const box = state.boxes[Math.round(i)];
    if (box) {
      fillSurround(
        front.x + box.x0 * front.w,
        front.y + box.y0 * front.h,
        (box.x1 - box.x0) * front.w,
        (box.y1 - box.y0) * front.h
      );
    }

    /* back to CSS pixels, so the hotspot layer can sit exactly on the frame */
    state.imgRect = {
      x: front.x / state.dpr,
      y: front.y / state.dpr,
      w: front.w / state.dpr,
      h: front.h / state.dpr,
    };
    syncHotspotLayer();

    applyTheme(Math.round(i));
  }

  function applyTheme(i) {
    const lum = state.luma[i];
    let isLight = state.isLight;
    /* hysteresis so a single dark frame doesn't strobe the text */
    if (!isLight && lum > CONFIG.lightAbove) isLight = true;
    else if (isLight && lum < CONFIG.darkBelow) isLight = false;

    if (isLight !== state.isLight) {
      state.isLight = isLight;
      pin.classList.toggle('is-dark', !isLight);
    }
  }

  /* ── Loader cinematic: the Nothing logo, drawn on canvas ─
     The brief: a cinematic brand moment on the loader — the Nothing
     wordmark, not the product. The "film" is drawn: the real Nothing logo
     asset (nothing-logo.png) rasterised to dot-matrix points that
     materialise from a slow particle drift, lit with sweeping scan passes
     over a vignette.

     The points come from the logo's own pixels, so the formation traces the
     actual brand mark; the resolve draws the same asset crisply at the
     display size. If the asset is missing, undecodable or blocked (file://
     canvas reads), the wordmark falls back to the same animation built from
     live type — no image asset required. */
  const cine = { canvas: null, ctx: null, raf: 0, pts: [], dots: [],
                 w: 0, h: 0, dpr: 1, start: 0, cycle: 0,
                 subEl: null, subTimer: 0, logo: null, logoPromise: null };

  /* the real brand asset — the Nothing wordmark, fetched from logo.dev for
     nothing.tech — embedded as a data URI so the cinematic works from any
     origin, including file:// pages where an external image would taint the
     canvas and break the pixel reads. nothing-logo.png in the project root is
     the source asset; see README for how to regenerate this embed. */
  const LOGO_SRC = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABAAAAAQACAIAAADwf7zUAACAAElEQVR4nOzdaXCc5b3nfan3ltRq7Ztlbd6w2Www2GMySRgwgbAnGWAgYUKSmspkUlNTlZlUkqq8OHXqVOVF3p6q1KkTyKmEzQaCbQKJje0AwQav2GAbW/u+d6ulXqRuLU+V/3X+dT13y8JItkXO9f28oITc6r77Xq/ftbpyAAAAAFiDAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAAWIQAAAAAAFiEAAAAAABYhAAAAAAA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ffXVVwcGBuS4x2IxuU77+vqee+65u+66KxAIuN3u/Px8j8dTW1v7f/7P/zly5Mj4+Li8fnx8PBaLTU5Onjt37pe//OX69ev14/Ly8rZu3frss8+2t7dHo1HZbPkWkUhk165dX//61x23L/0ievj03HYMdAkEAjfddNOvf/3r9vb28fFxef+xsTE55995552nn35aipvLfmMU5lCWqqqqH/7wh++9997ExEQ8Hpd9mEgk0un0J5988g//8A833HDDFf/07N/Ibqyvr//Hf/zHc+fOTVwk51g8Hh8ZGfnb3/72ox/9qKamRv7E7XYXFhZu3759586dQ0NDchOIRCIjIyPywx/+8If7779fbndySTY1Nf30pz89fvy43IUmJiai0ejoRadOnfrFL35RUVGhm1RQUPCVr3zlN7/5TWdnp954o9HoxMTEyMjIvn37nnrqqZKSEvMrLMsVCtswCBhXS/Y4S/mhpKTkwQcffOaZZzZu3JiXl6cdW6W5XMqpVVVV0qcilUotvRy5CFrRaPa4DQaDX/nKV773ve9t3769oKBA+omaLfLhcLiqqsrtdnd1dSUSiSu4MY6f5+bmCgsLH3/88aeffvqWW27Jy8vTF0jDt8fjqaysrK6uzs3NlT4PjY2NP/zhD5988sn6+nqv1ysNFNpQ7vf7V6xYEQwGBwYGBgcHvV7vpk2bfvKTn9x5553Sji91rnqwwuHwtm3bJicn29raUqmUx+OZty/Q0r+yNOI//PDDP/nJT2666SZpKdJ6NdnylStXNjQ0DA0NdXV1zczMNDU1PfXUU9/+9rcbGhqSyaTX69V6VtnyhoaGurq64eHh3t5ev9//wAMPfPe73922bVtBQYEc60wm4/P5pGNAWVnZihUr/H5/R0dHIpGoqqr6H//jfzzzzDOrVq2S/gxy6OUM8fl80ijUd1Fubu7111//85///J577pFKZTlA2ieksrJy48aNc3Nzn3zyydTUVPZT3yzd6leWbzQ9Pb1q1apf/vKX991334oVK7TLgXbMKC4uXrt2bU5OjpRNzY7X177OWHsxyf/m5eU988wz/+t//a/Vq1d7L5JTS17g8/lWrlxZX1/f0tIyMDDg2FrtLSP7XIrC2tl6dnY2HA4/8sgjTz755O23315QUKB9uOU6lTtMQ0ODy+Vqbm6enJy84YYbfvjDHz700ENNTU2y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aWHn5eU988wzXq83HA6//fbbXq/3G9/4xk9+8pPy8vLIHTocF4vFnE7nnj17CgsLFxcX5+fnb9++nZKSYo6SWeYSmGGA3GEee+yxV1555f7775fxCrmFatJabW1tSUlJampqNBo1A4yt7WaWu9zevXsl6MrOzpY9I0WrZD5Sfn7+4cOHc3JyFhcX3377bRlptAQSa2NZoVlCka997Ws/+9nP7r//fpfLFYlEwuGwPIkikcjy8nJtbW1NTY3T6YzFYp988klOTs43v/nNl156qaCgYGFhYW5uTs5SOXCpqakPP/xwdnZ2KBSStMAHHnjgP//n//yd73xnfn4+EonovDXZmPz8/GeeeSY9PX1ycvLChQty+m3czgY2DBPVsYksa5c6HI7S0tInn3zyBz/4QW1tbSwWk0a/uWaK1EWWZnR/f//t27fNtcCSv/06NJGamrp79+6XXnrp0Ucflb52c5KidkF5PJ6SkpKFhYVr167JEPA6a1ysutBPenr6ww8//N/+23+rqqqSeY3SCtHpBzIvuaSkxOPxXL9+fXJy8siRI88991xmZqZ0tWpTTH5eXFyU5N1t27b19PSkp6f//d///YMPPhiNRhNreEt/qsfjycvLC4fDPT09kvC6jj2dJGYpFZlh+eCDD/793//9nj175ufnZe/ptGaJjuRszM/PHxwcbG9v36qUJ7MKrQw6SRv6ueeek/wQrUWj2y9dnvLV2traJiYmtnwRA7nSi4qKvvvd737nO98pKytbuEP7v81God/vr62tbW1tHRwc1LvE51YJS0tLO3LkyE9/+tO6urpIJBKNRp1Op2RumKWTZFDr0qVLCwsLhw8ffuaZZzIyMrTwi77/0tJSNBpNS0uTpmFHR0deXt7f/u3f7tmzRybmyst082T/e73evLy82dnZ27dvx2KxxMXatNynZU1cucM8/vjjkshnWeVK/7ChoWFsbKyjo2Nubk7+KcmVQC0VihwOR1lZ2Ysvvnjo0CHp1pH4WTt9pECCy+UKBAI5OTkdHR29vb06kWn9J6SZqOl0Ouvr67/3ve9961vfkgnx5iUvmWDRaNTj8TQ0NPT393/66af33XffT37yk5qaGnPdDzmasuXxeDwjI8Pr9XZ1dcVisRdeeOHnP/+5hGeaRaYLtMViMZfLlZubG41GBwYGxsbG/ir6R2BDBADYRJoDqnPy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2AgBAAAAAGAjBAAAAACAjRAAAAAAADZCAAAAAADYCAEAAAAAYCMEAAAAAICNEAAAAAAANkIAAAAAANgIAQAAAABgIwQAAAAAgI0QAAAAAAA2QgAAAAAA2AgBAAAAAGAjBAAAAACAjRAAAAAAADZCAAAAAADYCAEAAAAAYCMEAAAAAICNEAAAAAAANkIAAAAAANgIAQAAAABgIwQAAAAAgI0QAAAAAAA2QgAAAAAA2AgBAAAAAGAjBAAAAACAjRAAAAAAADZCAAAAAADYCAEAAAAAYCMEAAAAAICNEAAAAAAANkIAAAAAANgIAQAAAABgIwQAAAAAgI0QAAAAAAA2QgAAAAAA2AgBAAAAAGAjBAAAAACAjRAAAAAAADZCAAAAAADYCAEAAAAAYCMEAAAAAICNEAAAAAAANkIAAAAAANgIAQAAAABgIwQAAAAAgI0QAAAAAAA2QgAAAAAA2AgBAAAAAGAjBAAAAACAjRAAAAAAADZCAAAAAADYCAEAAAAAYCMEAAAAAICNEAAAAAAANkIAAAAAANgIAQAAAABgIwQAAAAAgI0QAAAAAAA2QgAAAAAA2AgBAAAAAGAjBAAAAACAjRAAAAAAADZCAAAAAADYCAEAAAAAYCMEAAAAAICNEAAAAAAANkIAAAAAANgIAQAAAABgIwQAAAAAgI0QAAAAAAA2QgAAAAAA2AgBAAAAAGAjBAAAAACAjRAAAAAAADZCAAAAAADYCAEAAAAAYCMEAAAAAICNEAAAAAAANkIAAAAAANgIAQAAAABgIwQAAAAAgI0QAAAAAAA2QgAAAAAA2AgBAAAAAGAjBAAAAACAjRAAAAAAADZCAAAAAADYCAEAAAAAYCMEAAAAAICNEAAAAAAANkIAAAAAANgIAQAAAABgIwQAAAAAgI0QAAAAAAA2QgAAAAAA2AgBAAAAAGAjBAAAAACAjRAAAAAAADZCAAAAAADYCAEAAAAAYCMEAAAAAICNEAAAAAAANkIAAAAAANgIAQAAAABgIwQAAAAAgI0QAAAAAAA2QgAAAAAA2AgBAAAAAGAjBAAAAACAjRAAAAAAADZCAAAAAADYCAEAAAAAYCMEAAAAAICNEAAAAAAANkIAAAAAANgIAQAAAABgIwQAAAAAgI0QAAAAAAA2QgAAAAAA2AgBAAAAAGAjBAAAAACAjRAAAAAAADZCAAAAAADYCAEAAAAAYCMEAAAAAICNEAAAAAAANkIAAAAAANgIAQAAAABgIwQAAAAAgI0QAAAAAAA2QgAAAAAA2AgBAAAAAGAjBAAAAACAjRAAAAAAADZCAAAAAADYCAEAAAAAYCMEAAAAAICNEAAAAAAANkIAAAAAANgIAQAAAABgIwQAAAAAgI0QAAAAAAA2QgAAAAAA2AgBAAAAAGAjBAAAAACAjRAAAAAAADZCAAAAAADYCAEAAAAAYCMEAAAAAICNEAAAAAAANkIAAAAAANgIAQAAAABgIwQAAAAAgI0QAAAAAAA2QgAAAAAA2AgBAAAAAGAjBAAAAACAjRAAAAAAADZCAAAAAADYCAEAAAAAYCMEAAAAAICNEAAAAAAANkIAAAAAANgIAQAAAABgIwQAAAAAgI0QAAAAAAA2QgAAAAAA2AgBAAAAAGAjBAAAAACAjRAAAAAAADZCAAAAAADYCAEAAAAAYCMEAAAAAICNEAAAAAAANkIAAAAAANgIAQAAAABgIwQAAAAAgI0QAAAAAAA2QgAAAAAA2AgBAAAAAGAjBAAAAACAjRAAAAAAADZCAAAAAADYCAEAAAAAYCMEAAAAAICNEAAAAAAANkIAAAAAANgIAQAAAABgIwQAAAAAgI0QAAAAAAA2QgAAAAAA2AgBAAAAAGAjBAAAAACAjRAAAAAAADZCAAAAAADYCAEAAAAAYCMEAAAAAICNEAAAAAAANkIAgP8f+3UgAAAAACDI33qQyyIAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgQAAABGBAAAAEYEAAAARgoAAP//uH57V0m/JlIAAAAASUVORK5CYII=";
  /* how long the cinematic waits for the asset before falling back to type */
  const CINE_LOGO_WAIT = 700; /* ms */

  /* wordmark + subline. The wordmark condenses from drifting particles,
     then resolves into a crisp solid fill that holds — no dissolve loop —
     so the logo is always fully readable. */
  const CINE_LINES = [
    { text: 'NOTHING', sub: false, scale: 1.0,  y: 0.5,  delay: 0.0 },
    { text: 'by Nothing', sub: true, scale: 0.30, y: 0.635, delay: 0.7 },
  ];
  /* solid phase: when the dots fuse into one clean, solid wordmark */
  const CINE_SOLID_START = 3.4;   /* s after the cycle starts */
  const CINE_SOLID_SPAN = 1.2;    /* s the resolve takes */
  const CINE_SOLID_FILL = '#f2f3f5';
  const CINE_SOLID_SUB = 'rgba(231, 233, 236, 0.6)';

  /* ── The real logo asset ─────────────────────────────
     The PNG ships as the white wordmark on a solid black square, with no
     alpha. To composite it over the animated backdrop it is re-matted onto
     transparency: the backdrop's polarity is detected from a corner pixel,
     every pixel's "ink level" becomes alpha, and the ink is repainted in
     the loader's mist white. The result is trimmed to its bounding box so
     fitting and sampling work regardless of the source's padding. */
  function prepareLogo(img) {
    try {
      const maxSide = 1024;
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));

      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const octx = off.getContext('2d', { willReadFrequently: true });
      if (!octx) return null;
      octx.drawImage(img, 0, 0, w, h);

      const src = octx.getImageData(0, 0, w, h);
      const s = src.data;

      /* polarity: dark backdrop → ink is bright; light backdrop → ink is dark;
         real alpha in the source → trust it outright */
      const corner = (s[3] + s[(w - 1) * 4 + 3] + s[(h - 1) * w * 4 + 3]) / 3;
      const hasAlpha = corner < 250;
      const bgLum = 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
      const inkIsBright = bgLum < 128;

      const out = octx.createImageData(w, h);
      const o = out.data;
      for (let i = 0; i < w * h; i++) {
        const p = i * 4;
        const a = hasAlpha
          ? s[p + 3]
          : inkIsBright
            ? Math.max(s[p], s[p + 1], s[p + 2])
            : 255 - Math.min(s[p], s[p + 1], s[p + 2]);
        o[p] = 242;            /* CINE_SOLID_FILL, mist white */
        o[p + 1] = 243;
        o[p + 2] = 245;
        o[p + 3] = a;
      }
      octx.putImageData(out, 0, 0);

      /* trim to the ink so fitting never sees the source's padding */
      let minX = w, minY = h, maxX = -1, maxY = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (o[(y * w + x) * 4 + 3] > 16) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) return null;

      const tw = maxX - minX + 1;
      const th = maxY - minY + 1;
      const trim = document.createElement('canvas');
      trim.width = tw;
      trim.height = th;
      const tctx = trim.getContext('2d');
      if (!tctx) return null;
      tctx.drawImage(off, minX, minY, tw, th, 0, 0, tw, th);
      return { img: trim, w: tw, h: th };
    } catch (err) {
      /* file:// pages taint canvases that drew local images — fall back to type */
      return null;
    }
  }

  function loadLogo() {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(prepareLogo(img));
      img.onerror = () => resolve(null);
      img.src = LOGO_SRC;
    });
  }

  function cineSize() {
    const c = cine.canvas;
    if (!c) return;
    cine.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, Math.round(loader.clientWidth * cine.dpr));
    const h = Math.max(240, Math.round(loader.clientHeight * cine.dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    cine.w = w; cine.h = h;
    cine.pts = []; /* force a rebuild — point layout depends on the size */
  }

  /* Rasterise the wordmark to points: draw the logo (or, in its absence, the
     fallback type) to an offscreen buffer at the display size, then keep every
     opaque pixel whose row above it was empty (the top edge of each 'dot
     row'). The result is a dot-matrix grid clipped to the mark. */
  function cineBuild() {
    if (!cine.ctx || !cine.w) return;
    cine.pts = [];

    const off = document.createElement('canvas');
    off.width = cine.w;
    off.height = cine.h;
    const octx = off.getContext('2d', { willReadFrequently: true });
    if (!octx) return;

    /* bands of the buffer that were drawn to, so sampling knows where to look */
    const bands = [];

    if (cine.logo) {
      /* the real asset, fitted into the space the wordmark occupied */
      const maxW = cine.w * 0.66;
      const maxH = cine.h * 0.3;
      const s = Math.min(maxW / cine.logo.w, maxH / cine.logo.h);
      const w = cine.logo.w * s;
      const h = cine.logo.h * s;
      octx.drawImage(cine.logo.img, cine.w / 2 - w / 2, cine.h * 0.5 - h / 2, w, h);
      bands.push({
        top: Math.round(cine.h * 0.5 - h / 2) - 2,
        bot: Math.round(cine.h * 0.5 + h / 2) + 2,
      });
    } else {
      const fontStack = '700 %spx ' + getComputedStyle(document.body).fontFamily;
      for (const line of CINE_LINES) {
        const size = Math.min(cine.w * (line.sub ? 0.085 : 0.17), line.sub ? 90 : 220);
        octx.font = fontStack.replace('%s', Math.round(size));
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        octx.fillStyle = line.sub ? CINE_SOLID_SUB : '#fff';
        octx.fillText(line.text, cine.w / 2, cine.h * line.y);
        bands.push({
          top: Math.round(cine.h * (line.y - (line.sub ? 0.06 : 0.2))),
          bot: Math.round(cine.h * (line.y + (line.sub ? 0.06 : 0.2))),
        });
      }
    }

    const data = octx.getImageData(0, 0, cine.w, cine.h).data;
    /* pitch scales with the viewport so the matrix stays even */
    const pitch = Math.max(6, Math.round(cine.w / 130)) * cine.dpr;
    const rad = pitch * 0.34;

    for (const band of bands) {
      for (let y = band.top; y < band.bot; y += pitch) {
        let run = false;
        for (let x = 0; x < cine.w; x += 2) {
          const p = (y * cine.w + x) * 4;
          const on = data[p + 3] > 140;
          if (on && !run) {
            run = true;
            cine.pts.push({ x: x, y: y, r: rad });
          } else if (!on) {
            run = false;
          }
        }
      }
    }
  }

  function cineInit(now) {
    cineSize();
    cineBuild();
    cine.dots = cine.pts.map((p) => ({
      x: p.x + (Math.random() - 0.5) * cine.w * 0.35,
      y: p.y + (Math.random() - 0.5) * cine.h * 0.4,
      vx: (Math.random() - 0.5) * 6,
      vy: (Math.random() - 0.5) * 6,
      d: Math.random(),
    }));
    cine.start = now;
    cine.cycle = now;

    /* the small 'by Nothing' line belongs to the solid wordmark, not the dot
       phase — hide it until the resolve, then fade it in via CSS */
    if (cine.subEl) {
      cine.subEl.style.opacity = '0';
      clearTimeout(cine.subTimer);
      cine.subTimer = setTimeout(() => {
        cine.subEl.style.transition = 'opacity 0.8s var(--ease)';
        cine.subEl.style.opacity = '1';
      }, CINE_SOLID_START * 1000 + 400);
    }
  }

  /* One shot: dots settle (2.6s), hold (1.8s), then the wordmark resolves
     into a crisp solid fill that holds until the page is ready. No dissolve
     loop — once formed, the logo stays fully readable. */
  const CINE_SETTLE = 2.6;
  const CINE_HOLD = 1.8;

  function cineTick(now) {
    if (state.ready || !cine.ctx) return;
    cine.raf = requestAnimationFrame(cineTick);
    if (!cine.pts.length) cineBuild();
    if (!cine.pts.length) return;

    const ctx = cine.ctx;
    const W = cine.w, H = cine.h;

    /* one-shot clock, in seconds since the cycle began */
    const t = (now - cine.cycle) / 1000;
    const settle = smoothstep(0, CINE_SETTLE, t);
    /* 0 → 1: the dot matrix fuses into one clean, solid wordmark */
    const solid = smoothstep(CINE_SOLID_START, CINE_SOLID_START + CINE_SOLID_SPAN, t);

    ctx.fillStyle = '#08090a';
    ctx.fillRect(0, 0, W, H);

    if (solid < 1) {
      /* loose particle bed behind the wordmark — the "footage" the dots condense from */
      const bedN = Math.min(90, Math.round(W / 16));
      ctx.fillStyle = `rgba(231, 233, 236, ${(0.05 * (1 - solid)).toFixed(3)})`;
      for (let i = 0; i < bedN; i++) {
        const sx = ((i * 997 + t * 26) % (W + 80)) - 40;
        const sy = (i * 613 + Math.sin(t * 0.4 + i) * 30 + t * 9) % H;
        ctx.fillRect(sx, sy, cine.dpr, cine.dpr);
      }

      /* dot-matrix wordmark: each dot eases from its scattered start to its
         glyph position, staggered by index, then swells and brightens as it
         fuses into the solid fill */
      const ease = 1 - Math.pow(1 - settle, 3);
      for (let i = 0; i < cine.pts.length; i++) {
        const p = cine.pts[i];
        const d = cine.dots[i] || { x: p.x, y: p.y, d: 0 };
        const stag = clamp(ease * 1.35 - d.d * 0.35, 0, 1);
        const e = 1 - Math.pow(1 - stag, 3);
        const x = p.x + (d.x - p.x) * (1 - e);
        const y = p.y + (d.y - p.y) * (1 - e);
        const a = (0.25 + 0.75 * e) * (1 - solid * 0.85) + solid * 0.85;
        const r = p.r * (0.55 + 0.45 * e) * (1 + solid * 1.35);

        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.4, r), 0, 6.2832);
        ctx.fillStyle = `rgba(231, 233, 236, ${a.toFixed(3)})`;
        ctx.fill();
      }

      /* scanning light pass during formation only, so it never washes the
         finished wordmark */
      const scanY = H * ((t * 0.22) % 1.4 - 0.2);
      const g = ctx.createLinearGradient(0, scanY - H * 0.12, 0, scanY + H * 0.12);
      g.addColorStop(0, 'rgba(231, 233, 236, 0)');
      g.addColorStop(0.5, `rgba(231, 233, 236, ${(0.06 * (1 - solid)).toFixed(3)})`);
      g.addColorStop(1, 'rgba(231, 233, 236, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    /* vignette baked into the canvas, so it composites in one layer */
    const vg = ctx.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.32, W / 2, H * 0.5, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(6, 7, 8, 0)');
    vg.addColorStop(1, 'rgba(6, 7, 8, 0.9)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    /* the resolve: draw the finished logo — the real asset when available,
       otherwise the wordmark as solid type — on top of everything. Above the
       vignette and undimmed, so it is crisp and uniformly bright. The small
       'by Nothing' line is real HTML text below it, faded in by cineInit. */
    if (solid > 0) {
      if (cine.logo) {
        const maxW = W * 0.66;
        const maxH = H * 0.3;
        const s = Math.min(maxW / cine.logo.w, maxH / cine.logo.h);
        const w = cine.logo.w * s;
        const h = cine.logo.h * s;
        ctx.globalAlpha = solid;
        ctx.drawImage(cine.logo.img, W / 2 - w / 2, H * 0.5 - h / 2, w, h);
        ctx.globalAlpha = 1;
      } else {
        const fontStack = '700 %spx ' + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = solid;
        ctx.font = fontStack.replace('%s', Math.round(Math.min(W * 0.17, 220)));
        ctx.fillStyle = CINE_SOLID_FILL;
        ctx.fillText('NOTHING', W / 2, H * 0.5);
        ctx.globalAlpha = 1;
      }
    }
  }

  async function startLoaderCinematic() {
    /* reduced motion: keep the plain loader rather than a moving backdrop */
    if (reducedMotion) return;

    /* needed before cineInit, which schedules the tagline's fade-in */
    cine.subEl = document.querySelector('.loader__tagline');

    /* give the logo asset a brief head start — it is local and preloaded, so
       this resolves almost immediately; a slow or missing asset falls back to
       the type-built wordmark rather than delaying the loader */
    cine.logoPromise = loadLogo();
    cine.logo = await Promise.race([
      cine.logoPromise,
      new Promise((r) => setTimeout(() => r(null), CINE_LOGO_WAIT)),
    ]);
    if (state.ready) return; /* loader already finished while we waited */

    const canvas = document.getElementById('loader-logo');
    if (canvas && canvas.getContext) {
      cine.canvas = canvas;
      cine.ctx = canvas.getContext('2d', { alpha: false });
      if (cine.ctx) {
        cineSize();
        cineInit(performance.now());
        cine.raf = requestAnimationFrame(cineTick);
      }
    }

    loader.classList.add('is-backed');

    const fb = document.getElementById('loader-video-fallback');

    if (fb) {
      const armFb = () => {
        fb.classList.add('is-on');
        loader.classList.add('has-video');
      };
      fb.play().catch(() => {});
      if (fb.readyState >= 1) armFb();
      fb.addEventListener('playing', armFb, { once: true });
      fb.addEventListener('canplay', armFb, { once: true });
    }
  }

  function stopLoaderCinematic() {
    cancelAnimationFrame(cine.raf);
    cine.raf = 0;
    clearTimeout(cine.subTimer);
    const fb = document.getElementById('loader-video-fallback');
    if (fb) fb.pause();
  }

  /* ── Outro: the Nothing wordmark reassembles from dots ──
     Same dot-matrix language as the loader, replayed as a finale after the
     buds sequence ends: particles settle into the wordmark + line of copy,
     then breathe gently. Off for reduced motion. */
  const outroLogo = {
    el: document.getElementById('outro-logo'),
    fig: document.querySelector('.outro__logo'),
    ctx: null, pts: [], dots: [], raf: 0, start: 0, on: false,
  };
  const OUTRO_SETTLE = 2.2;
  const OUTRO_HOLD = 1.6;

  function outroBuild() {
    const cv = outroLogo.el, fig = outroLogo.fig;
    if (!cv || !fig) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(fig.clientWidth * dpr));
    const h = Math.max(2, Math.round(fig.clientHeight * dpr));
    cv.width = w;
    cv.height = h;
    outroLogo.ctx = cv.getContext('2d');

    /* sample the wordmark offscreen, then keep one dot per run — the
       tagline below stays real text (dots turn to noise at that size) */
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const octx = off.getContext('2d');
    if (!octx) return;
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.fillStyle = '#fff';
    octx.font = '700 ' + Math.round(h * 0.62) + 'px ' + getComputedStyle(document.body).fontFamily;
    octx.fillText('NOTHING', w / 2, h * 0.52);

    const data = octx.getImageData(0, 0, w, h).data;
    const pitch = Math.max(6, Math.round(w / 150)) * dpr;
    const rad = pitch * 0.34;
    outroLogo.pts = [];
    for (let y = 0; y < h; y += pitch) {
      let run = false;
      for (let x = 0; x < w; x += 2) {
        const on = data[(y * w + x) * 4 + 3] > 140;
        if (on && !run) {
          run = true;
          outroLogo.pts.push({ x, y, r: rad });
        } else if (!on) {
          run = false;
        }
      }
    }
    outroLogo.dots = outroLogo.pts.map((p) => ({
      x: p.x + (Math.random() - 0.5) * w * 0.5,
      y: p.y + (Math.random() - 0.5) * h * 1.4,
      d: Math.random(),
    }));
  }

  function outroTick(now) {
    if (!outroLogo.on) return;
    outroLogo.raf = requestAnimationFrame(outroTick);
    const ctx = outroLogo.ctx;
    if (!ctx || !outroLogo.pts.length) return;
    const W = outroLogo.el.width, H = outroLogo.el.height;
    const t = (now - outroLogo.start) / 1000;
    const settle = smoothstep(0, OUTRO_SETTLE, t);

    /* once formed, the dots breathe once per hold — subtle life, no loop restart */
    const cyc = t % (OUTRO_SETTLE + OUTRO_HOLD);
    const breathe = 0.85 + 0.15 * Math.sin(clamp((cyc - OUTRO_SETTLE) / OUTRO_HOLD, 0, 1) * Math.PI);

    ctx.clearRect(0, 0, W, H);
    const ease = 1 - Math.pow(1 - settle, 3);
    for (let i = 0; i < outroLogo.pts.length; i++) {
      const p = outroLogo.pts[i];
      const d = outroLogo.dots[i] || { x: p.x, y: p.y, d: 0 };
      const stag = clamp(ease * 1.35 - d.d * 0.35, 0, 1);
      const e = 1 - Math.pow(1 - stag, 3);
      const x = p.x + (d.x - p.x) * (1 - e);
      const y = p.y + (d.y - p.y) * (1 - e);
      const r = p.r * (0.55 + 0.45 * e) * breathe;

      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.4, r), 0, 6.2832);
      ctx.fillStyle = 'rgba(231, 233, 236, ' + (0.35 + 0.65 * e).toFixed(3) + ')';
      ctx.fill();
    }
  }

  function startOutroLogo() {
    const fig = outroLogo.fig;
    if (!fig || !outroLogo.el) return;
    if (reducedMotion) {
      fig.classList.add('is-on');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.disconnect();
          outroBuild();
          fig.classList.add('is-on');
          if (!outroLogo.pts.length) return;
          outroLogo.on = true;
          outroLogo.start = performance.now();
          outroLogo.raf = requestAnimationFrame(outroTick);
        }
      },
      { threshold: 0.35 }
    );
    io.observe(fig);
    /* rebuild if the figure is resized after it started (orientation etc.) —
       bound once, so repeated entries can't stack listeners */
    if (!outroLogo.resizeBound) {
      outroLogo.resizeBound = true;
      window.addEventListener('resize', () => {
        if (!outroLogo.on) return;
        cancelAnimationFrame(outroLogo.raf);
        outroLogo.on = false;
        startOutroLogo();
      });
    }
  }

  /* ── Preload ───────────────────────────────────────────── */
  function loadImage(src, retries = 2) {
    return new Promise((resolve) => {
      const attempt = (n) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => {
          if (n > 0) {
            setTimeout(() => attempt(n - 1), 250);
          } else {
            resolve(null);
          }
        };
        img.src = src;
      };
      attempt(retries);
    });
  }

  function setProgress(loaded) {
    const pct = Math.round((loaded / state.numbers.length) * 100);
    loaderBar.style.width = pct + '%';
    loaderPct.textContent = pct + '%';
  }

  async function preload() {
    const numbers = state.numbers;

    /* frame 001 first so there is always something on screen */
    const first = await loadImage(fileName(numbers[0]));
    if (first) {
      state.frames[0] = first;
      analyse(0, first);
    }
    sizeCanvas();
    drawAt(0);

    let loaded = first ? 1 : 0;
    setProgress(loaded);

    let cursor = 1;
    const worker = async () => {
      while (cursor < numbers.length) {
        const i = cursor++;
        const img = await loadImage(fileName(numbers[i]));
        if (img) {
          state.frames[i] = img;
          analyse(i, img);
        }
        loaded++;
        setProgress(loaded);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONFIG.concurrency, numbers.length - 1) }, worker)
    );
  }

  /* ── Scroll-spy targets ─────────────────────────────────
     Section edges are cached and refreshed on resize — updateOverlays runs
     every frame, so it must never trigger layout reads itself. */
  function collectSections() {
    if (!state.sections) state.sections = [];
    state.sections = navLinks
      .map((link) => {
        const id = (link.getAttribute('href') || '').slice(1);
        return document.getElementById(id);
      })
      .filter(Boolean)
      .map((el) => ({ id: el.id, el, start: 0 }));
    refreshSectionEdges();
  }

  function refreshSectionEdges() {
    for (const s of state.sections) s.start = s.el.getBoundingClientRect().top + window.scrollY;
    /* nav link order ≠ document order (nav lists Inside before Materials);
     the spy's early-break scan needs ascending offsets */
    state.sections.sort((a, b) => a.start - b.start);
  }

  /* ── Overlays: beats, hud, hint ────────────────────────── */
  /* Each beat block (eyebrow + title + body) fades in as one cohesive unit
     over its data-in → data-in+fade window, rising 22px as it appears.
     No per-line stagger — the whole block arrives together so the text reads
     in a clean order instead of line-by-line like frames. The beat's
     data-in / data-out still decide when it appears and leaves. */
  const BEAT_SHIFT = 22;        /* px the block rises while fading in */
  const BEAT_SCALE = 0.96;      /* block scales from this up to 1 as it fades in */

  function collectBeats() {
    state.beats = Array.from(document.querySelectorAll('.beat')).map((el) => ({
      el,
      in: parseFloat(el.dataset.in || '0'),
      out: parseFloat(el.dataset.out || '1'),
      fade: 0.06,
      lines: Array.from(el.children).map((c) => ({ el: c })),
    }));
  }

  /* ── Component callouts ─────────────────────────────────── */
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function collectHotspots() {
    if (!legend || !hotspotLayer) return;
    const items = Array.from(legend.querySelectorAll('.hotspot'));

    /* one leader line per component, drawn from its legend card out to the
       marker on the model — minted here alongside the dots so the callout
       layer always stays in sync with the legend */
    const leads = document.createElementNS(SVG_NS, 'svg');
    leads.setAttribute('class', 'legend-leads');
    leads.setAttribute('aria-hidden', 'true');

    state.hotspots = items.map((li, i) => {
      const x = parseFloat(li.dataset.x || '0.5');
      const y = parseFloat(li.dataset.y || '0.5');
      const at = parseFloat(li.dataset.at || '0.9');

      /* number the legend row and mint a matching dot on the part */
      const no = li.querySelector('.hotspot__no');
      if (no) no.textContent = String(i + 1);

      const dot = document.createElement('span');
      dot.className = 'hotspot-dot';
      dot.textContent = String(i + 1);
      dot.setAttribute('aria-hidden', 'true');
      dot.style.left = (x * 100).toFixed(3) + '%';
      dot.style.top = (y * 100).toFixed(3) + '%';

      /* proximity tooltip: the component name sits right at the marker while
         it is active, so the label travels with the dot instead of living
         only in the corner legend */
      const tag = document.createElement('span');
      tag.className = 'hotspot-dot__tag';
      const nameEl = li.querySelector('.hotspot__body strong');
      tag.textContent = nameEl ? nameEl.textContent : '';
      dot.appendChild(tag);

      hotspotLayer.appendChild(dot);

      /* one shared active state: the marker and its legend row light up
         together, so the legend's colour changes always have a visible cause
         on the model */
      const link = () => {
        dot.classList.add('is-active');
        li.classList.add('is-active');
      };
      const unlink = () => {
        dot.classList.remove('is-active');
        li.classList.remove('is-active');
      };
      li.addEventListener('mouseenter', link);
      li.addEventListener('mouseleave', unlink);
      li.addEventListener('focus', link);
      li.addEventListener('blur', unlink);

      /* tapping a dot focuses its legend card, so touch gets the same
         reveal + active feedback that hover gives the desktop pointer */
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        li.focus();
      });

      /* fade must finish before progress hits 1, so the last callout
         reaches full opacity (see data-at values in index.html) */
      const lead = document.createElementNS(SVG_NS, 'line');
      leads.appendChild(lead);

      return { li, dot, no, lead, x, y, at, fade: 0.04 };
    });

    /* the hairlines live under the legend cards, so each one appears to
       emerge from its card's edge on the way to the marker */
    hotspotLayer.insertBefore(leads, legend);
  }

  /* keep the callout layer glued to the drawn frame, and the legend on screen */
  function syncHotspotLayer() {
    const r = state.imgRect;
    if (!r || !hotspotLayer || !legend) return;

    hotspotLayer.style.transform =
      `translate3d(${r.x.toFixed(2)}px, ${r.y.toFixed(2)}px, 0)`;
    hotspotLayer.style.width = r.w.toFixed(2) + 'px';
    hotspotLayer.style.height = r.h.toFixed(2) + 'px';

    /* frames are cropped or letterboxed, so anchor the legend to whatever part
       of the layer is actually on screen */
    const pad = state.mobile ? 12 : 20;
    const hiddenLeft = Math.max(0, -r.x);
    const hiddenRight = Math.max(0, r.x + r.w - pin.clientWidth);
    const hiddenBottom = Math.max(0, r.y + r.h - pin.clientHeight);

    /* the legend must never be wider than the viewport — on portrait letterbox
       fits the frame band is narrower than the screen, so a width derived only
       from the layer would run off the edges */
    const maxW = Math.max(180, Math.min(pin.clientWidth - pad * 2, 340));
    legend.style.maxWidth = maxW.toFixed(1) + 'px';

    if (state.mobile) {
      /* phones: the wide shot is letterboxed into a band, so the space above it
         is free and the bottom belongs to the copy. Clear the fixed nav. */
      const top = nav.offsetHeight + pad - r.y;
      legend.style.left = (hiddenLeft + pad).toFixed(1) + 'px';
      legend.style.right = 'auto';
      legend.style.top = top.toFixed(1) + 'px';
      legend.style.bottom = 'auto';
    } else {
      /* Desktop: bottom-right, anchored to the frame's on-screen part. The
         right-most dot (voice coil, data-x 0.585) must stay clear: reserve the
         gap between the dot and the legend's left edge, and shrink the legend
         if the frame is too narrow to offer it. */
      const dotX = r.w * 0.585 + r.x;               /* on-screen px of dot 5 */
      const gap = 16;
      const maxByDot = Math.max(180, dotX - gap);
      const avail = Math.max(180, pin.clientWidth - (hiddenRight + pad) - pad);
      legend.style.width = Math.min(320, maxByDot, avail).toFixed(1) + 'px';
      legend.style.right = (hiddenRight + pad).toFixed(1) + 'px';
      legend.style.left = 'auto';
      legend.style.bottom = (hiddenBottom + pad).toFixed(1) + 'px';
      legend.style.top = 'auto';
    }

    drawLeads();
  }

  /* leader lines: each card's number chip is anchored to its marker with a
     hairline, so label and signifier read as one unit even though the legend
     is anchored to the corner. Endpoints are computed in layer pixels and
     share the exact coordinate system the dots are positioned in. */
  function drawLeads() {
    const layerRect = hotspotLayer.getBoundingClientRect();
    for (const h of state.hotspots) {
      if (!h.lead || !h.no) continue;
      const chipRect = h.no.getBoundingClientRect();
      h.lead.setAttribute('x1', (chipRect.left + chipRect.width / 2 - layerRect.left).toFixed(1));
      h.lead.setAttribute('y1', (chipRect.top + chipRect.height / 2 - layerRect.top).toFixed(1));
      h.lead.setAttribute('x2', (h.x * layerRect.width).toFixed(1));
      h.lead.setAttribute('y2', (h.y * layerRect.height).toFixed(1));
    }
  }

  function updateOverlays() {
    const p = state.progress;

    /* the stage overlays are gone with the React port — guard the fixed chrome */
    if (!hudFill || !hudNum) return;

    for (const beat of state.beats) {
      const enter = smoothstep(beat.in, beat.in + beat.fade, p);
      const exit = smoothstep(beat.out - beat.fade, beat.out, p);
      const alpha = enter * (1 - exit);
      const y = (1 - enter) * 26 - exit * 26;

      beat.el.style.opacity = alpha.toFixed(3);
      beat.el.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
      beat.el.style.visibility = alpha < 0.01 ? 'hidden' : 'visible';
      beat.el.style.pointerEvents = alpha > 0.5 ? 'auto' : 'none';

      /* each beat block fades in as one unit: all lines share the same
         alpha and rise together, so the text reads as a clean block
         instead of line-by-line like frames */
      const blockScale = BEAT_SCALE + (1 - BEAT_SCALE) * enter;
      /* glow grows with the block entrance, peaks at full alpha, and
         recedes as the block exits so it never lingers after the text is
         gone */
      const glow = enter * (1 - exit);
      beat.el.style.setProperty('--beat-glow', glow.toFixed(3));
      /* after the block is fully in (enter ≈ 1) and before it exits,
         let the ambient halo breathe subtly — only the widest ring pulses,
         the inner rings stay steady. A smooth ease-in-out replaces the sine
         so each breath starts and ends softly rather than at full amplitude. */
      const t = Math.max(0, Math.min(1, (enter - 0.85) / 0.15));
      const phase = (p * 6) % 1;                       /* 0..1 over each breath */
      const ease = phase < 0.5
        ? 4 * phase * phase * phase                             /* cubic ease-in  */
        : 1 - Math.pow(-2 * phase + 2, 3) / 2;               /* cubic ease-out */
      const pulse = t * ease;
      beat.el.style.setProperty('--beat-glow-pulse', pulse.toFixed(3));
      for (let li = 0; li < beat.lines.length; li++) {
        const line = beat.lines[li];
        const lEnter = enter; /* same as the block's enter — no stagger */
        const lAlpha = lEnter * (1 - exit);
        const lY = (1 - lEnter) * BEAT_SHIFT - exit * 26;

        line.el.style.opacity = lAlpha.toFixed(3);
        line.el.style.transform = `translate3d(0, ${lY.toFixed(2)}px, 0) scale(${blockScale.toFixed(3)})`;
      }
    }

    /* callouts arrive one by one as the exploded view settles */
    for (const h of state.hotspots) {
      const alpha = smoothstep(h.at, h.at + h.fade, p);

      h.li.style.opacity = alpha.toFixed(3);
      h.li.style.transform = `translate3d(${((1 - alpha) * -14).toFixed(2)}px, 0, 0)`;
      h.li.style.visibility = alpha > 0.02 ? 'visible' : 'hidden';
      h.li.tabIndex = alpha > 0.5 ? 0 : -1;

      h.dot.style.opacity = alpha.toFixed(3);
      /* visibility — not just opacity — gates the dot, so invisible dots
         never sit in the way of taps on the frame */
      h.dot.style.visibility = alpha > 0.02 ? 'visible' : 'hidden';
      h.dot.style.transform = `scale(${(0.6 + alpha * 0.4).toFixed(3)})`;

      /* the leader line tracks its card's reveal */
      if (h.lead) {
        h.lead.style.opacity = alpha.toFixed(3);
        h.lead.style.visibility = alpha > 0.02 ? 'visible' : 'hidden';
      }
    }

    /* the chip's job is done once the callouts take over, and the progress bar
       moves aside on desktop to leave the bottom-right to the legend */
    const calloutsOn = p > 0.84;
    if (chip) chip.classList.toggle('is-hidden', calloutsOn);
    if (hud) hud.classList.toggle('is-left', calloutsOn && !state.mobile);

    hudFill.style.transform = `scaleY(${p.toFixed(4)})`;
    /* report the real source frame number — on phones the sequence skips every
       other frame, so the index would only ever count up to ~121 of 240 */
    const frameNo = state.numbers[clamp(state.lastIndex, 0, state.numbers.length - 1)];
    hudNum.textContent = String(frameNo || 1).padStart(3, '0');

    if (hint) {
      if (p > 0.02) hint.classList.add('is-hidden');
      else hint.classList.remove('is-hidden');
    }

    const y = window.scrollY;
    if (nav) {
      nav.classList.toggle('is-stuck', y > 24);
      /* flip the nav to its dark treatment once the dark sections below the
         sequence scroll up behind it */
      nav.classList.toggle('is-past', stage ? y > stage.offsetHeight - nav.offsetHeight - 40 : false);
    }
  }

  /* ── Scroll → progress ─────────────────────────────────── */
  function readScroll() {
    if (!stage || !pin) return;
    const rect = stage.getBoundingClientRect();
    /* measure against the pin's real height so vh/svh differences can't
       release the sticky element before progress reaches 1 */
    const travel = stage.offsetHeight - pin.offsetHeight;
    state.progress = travel > 0 ? clamp(-rect.top / travel, 0, 1) : 0;
    state.target = state.progress;
  }

  /* ── Scroll-spy ────────────────────────────────────────────
     Marks the nav link whose section is currently in view. Runs from tick()
     (not updateOverlays, which freezes once stage progress clamps at 1) and
     early-returns unless the active section actually changed. aria-current —
     not a class alone — keeps the state exposed to assistive tech for free. */
  function updateScrollSpy() {
    if (!state.sections || !state.sections.length) return;
    const mid = window.scrollY + window.innerHeight * 0.4;
    let current = null;
    for (const s of state.sections) {
      if (mid >= s.start) current = s.id;
      else break;
    }
    if (current === state.activeSection) return;
    state.activeSection = current;
    for (const link of navLinks) {
      if (current && link.getAttribute('href') === '#' + current) {
        link.setAttribute('aria-current', 'true');
      } else if (link.hasAttribute('aria-current')) {
        link.removeAttribute('aria-current');
      }
    }
  }

  /* ── Loop ──────────────────────────────────────────────── */
  const loadbar = document.getElementById('loadbar');
  let lastProgress = -1;

  function tick() {
    /* no buds stage in the React port — the rAF loop has nothing to scrub */
    if (!canvas || !ctx) return;
    const t = state.target;
    const ease = reducedMotion ? 1 : CONFIG.lerp;
    state.current += (t - state.current) * ease;
    if (Math.abs(t - state.current) < 0.0005) state.current = t;

    const idx = Math.round(state.current * (state.frames.length - 1));
    const changed = idx !== state.lastIndex;
    const moved = Math.abs(state.progress - lastProgress) > 0.0002;

    /* bottom rail: fills with the buds sequence; past 1 (logo outro) it stays
       full until the sequence is scrolled back into */
    if (loadbar && state.ready) {
      loadbar.style.setProperty('--p', String(clamp(state.current, 0, 1.04)));
      loadbar.classList.toggle('is-on', state.progress < 1);
    }

    if (changed || moved) {
      if (changed) {
        state.lastIndex = idx;
        drawAt(idx);
      }
      lastProgress = state.progress;
      updateOverlays();
    }

    updateScrollSpy();
    requestAnimationFrame(tick);
  }

  /* ── Staggered scroll reveal ───────────────────────────── */
  function initReveal() {
    /* Staggered scroll reveal, so the panels paint in as they arrive. Only
       armed when motion is allowed — otherwise the content is simply shown. */
    if (reducedMotion || !('IntersectionObserver' in window)) return;

    /* gates every JS-driven motion hook (loadbar, reveals) — not just the
       staggered panel reveals below, so arm it before the target check */
    document.documentElement.classList.add('js-motion');

    const targets = Array.from(document.querySelectorAll('.js-reveal'));
    if (!targets.length) return;
    targets.forEach((el, i) => {
      el.style.transitionDelay = Math.min(i * 90, 540) + 'ms';
    });

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.15 }
    );
    targets.forEach((el) => io.observe(el));
  }

  /* ── Boot ──────────────────────────────────────────────── */
  function finishLoading() {
    loader.classList.add('is-done');
    document.body.classList.remove('is-loading');
    state.ready = true;
    stopLoaderCinematic();
    sizeCanvas();
    readScroll();
    updateOverlays();
  }

  async function init() {
    /* how much scrolling the sequence is spread across */
    const lengthVh =
      window.innerWidth < CONFIG.mobileBreakpoint
        ? CONFIG.scrollVhMobile
        : CONFIG.scrollVhDesktop;
    if (stage) stage.style.setProperty('--stage-length', lengthVh + 'vh');

    state.mobile = window.matchMedia(CONFIG.mobileQuery).matches;

    buildFrameList();
    collectSections();
    collectBeats();
    collectHotspots();
    initReveal();
    startOutroLogo();
    startLoaderCinematic();
    sizeCanvas();
    readScroll();

    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());

    window.addEventListener('scroll', readScroll, { passive: true });
    window.addEventListener('resize', () => {
      state.mobile = window.matchMedia(CONFIG.mobileQuery).matches;
      sizeCanvas();
      cineSize();
      refreshSectionEdges();
      readScroll();
      syncHotspotLayer();
      state.lastIndex = -1;
    });

    /* safety net: never trap the visitor behind the loader */
    const bail = setTimeout(finishLoading, 25000);

    try {
      await preload();
    } catch (err) {
      console.warn('[cmp] preload issue:', err);
    }

    clearTimeout(bail);
    const missing = state.frames.filter((f) => !f).length;
    if (missing) {
      loaderHint.textContent = `${missing} frame(s) failed to load — check file names`;
      loaderHint.style.color = '#c4793c';
      await new Promise((r) => setTimeout(r, 1200));
    }

    finishLoading();
    requestAnimationFrame(tick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
