# CMF Buds — scroll-driven product sequence

> **2026 React port.** The site now runs on **Vite + React 18 + TypeScript + Tailwind CSS**
> with a shadcn project structure (`components.json`, `src/components/ui/`). The landing is
> the **Glyph Portal** component (`src/components/ui/glyph-portal.tsx`, MIT © Christian
> Katzmann): after the loader finishes, the word **NOTHING** fills a white stage over a
> black/copper backdrop (the component's green default is overridden) — pick a letter (the
> **O** by default), scroll, and fall through it straight into **the buds animation site**:
> the original 240-frame pinned scroll sequence (stage, beats, callouts) followed by
> Materials / Inside / Specs / Outro, restored as static markup in `index.html` and driven
> by `script.js` exactly as before.
>
> ```bash
> npm install
> npm run dev        # http://localhost:5173
> npm run build      # typecheck + single-file production build → dist/index.html
> node scripts/smoke.cjs   # headless-Chrome smoke test of the whole flow
> ```
>
> The build is a **self-contained single file** (`dist/index.html`, relative paths +
> inlined JS/CSS), so it also works by double-clicking it — no server needed. Open the
> project-root `index.html` directly and you get only the loader: the React app needs
> `npm run dev` (or the built `dist/index.html`).

A scroll-scrubbed (Apple-style) product site built from the **240 frames** in this folder
(`ezgif-frame-001.jpg` → `ezgif-frame-240.jpg`). The sequence opens on the closed case and
ends on the fully exploded view of the earbuds, driven entirely by scroll position.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure: pinned canvas stage, text beats, materials / features / specs / outro sections |
| `styles.css` | Palette + textures derived from the product, layout, responsive rules |
| `script.js` | Frame preloading, canvas rendering, scroll scrubbing, adaptive text theme |
| `ezgif-frame-*.jpg` | The 240 source frames (left in place at the project root) |
| `nothing-logo.png` | Source asset for the loader's logo (embedded into `script.js` as a data URI) |
| `loader.webm` / `loader.mp4` | Unused leftovers from an earlier video-loader experiment — safe to delete |

No build step, no dependencies.

## Run it

Open `index.html` directly, or serve the folder if you prefer a real origin:

```bash
npx serve .
# or
python -m http.server 8000
```

## How the animation works

1. **Preload** — every frame is fetched through a pool of 8 parallel requests. A loader
   shows percentage progress; frame 001 loads first so something is always on screen.
   Each frame is then analysed once, on a 240×135 probe canvas (see *Baked-in black
   surround* below).
2. **Pin** — `.stage` is `620vh` tall (JS sets `--stage-length`), and `.stage__pin` is
   `position: sticky; top: 0; height: 100vh`. The canvas stays fixed while the page scrolls.
3. **Scrub** — scroll progress through the stage maps to a frame index, which is drawn
   `cover`-fitted onto the canvas (device-pixel-ratio aware).
4. **Cover vs contain** — these are wide, centred compositions, so a `cover` fit on a tall
   screen throws the earbuds away. The renderer measures how much of the frame a cover fit
   would keep and switches to a blurred, dimmed backdrop with the whole frame composited on
   top when that drops below `0.85`:

   | Viewport | Cover keeps | Fit used |
   | --- | --- | --- |
   | 1920×1080 (16:9) | 100% | cover |
   | 1440×900 | 90% | cover |
   | 984×530 | 96% | cover |
   | 390×700 (phone) | 31% | contain + blur |

   The callouts depend on this: the layer they live in is pinned to whatever rectangle the
   frame ended up occupying, so they track the product under either fit.
5. **Weight** — the visible frame *lerps* toward the target frame each tick
   (`CONFIG.lerp`), so fast scrolling feels damped instead of jumpy.
6. **Theme** — light is the default, because the footage is shot on light studio backdrops.
   `script.js` only ever adds `.is-dark` to `.stage__pin`, and only if a frame's lit region
   is genuinely dark (with hysteresis, so it never strobes). Every beat also carries a soft
   radial scrim (`.beat::before`) keyed off the same theme, for where type crosses a dark
   part of the product.

## Baked-in black surround (why the opening frames needed special handling)

The first ~40 frames are not full-bleed: the product sits on a light panel with a **pure
black surround baked into the JPEG**. Measured lit (non-black) width:

| Frame | Lit width |
| --- | --- |
| 001 (hero) | 56% — 22% black down each side |
| 020 | 89% |
| 040 onward | 100% — no surround |

`analyse()` finds the lit box per frame by scanning the middle row and column of a downscaled
copy, and `fillSurround()` repaints `CONFIG.stageBackground` (white) over everything *outside*
that box, using a rounded-rect hole and `fill('evenodd')`.

Two things make this work:

- **The hole is inset into the panel, not expanded outward.** Growing it outward would leave
  the panel's rim and anti-aliased fringe dark — which shows up as a visible vertical line.
  Biting inwards is free, because white over a light backdrop is invisible.
- **Nothing pops when the fill stops.** By frame 040 the panel has expanded to a white
  backdrop on its own, so the corner tone goes 255 → 255 across the handover. Verified by
  sampling the canvas corner from frame 001 to 240.

Zooming to hide the bars instead would need ~1.8× and would slice the lid and base off, so
painting them out is the only option that keeps the product intact. Frames whose lit box
already fills the frame cost nothing — `state.boxes[i]` stays `null` and no fill runs.

## Texture & colour, taken from the product

Everything visual is sampled from the buds and the studio they were rendered in:

| Token | Value | Where it comes from |
| --- | --- | --- |
| `--ink` | `#0A0A0B` | matte earbud / case shell |
| `--graphite` | `#17191C` | lid and inner tray |
| `--steel` | `#9AA1A9` | driver rings, battery cells |
| `--copper` | `#C4793C` | voice-coil windings (accent) |
| `--mist` | `#E7E9EC` | studio backdrop |
| `--pcb` | `#2B4E86` | mainboard silkscreen |

**Two themes, on purpose.** The main page (the scroll stage) is light — matching the studio
backdrops — while the sections below it are dark. The stage therefore carries its own tokens
(`.stage__pin` and `.stage__pin.is-dark`) instead of inheriting the page's `--bg` / `--fg`.
The fixed nav spans both: it is dark-on-transparent over the light stage, glass-white once
scrolled (`.is-stuck`), and flips to its dark treatment via `.is-past` when the dark sections
come up behind it.

The callout legend and cards stay dark glass in both themes — on a light stage that solid
dark block is what makes the labels pop.

Three texture layers carry the material language through the UI:

- **Speckled shell** (`--speckle`) — a stipple pattern echoing the case's grained finish,
  used over the stage, panels and the outro.
- **Studio grain** (`--grain`) — an inline SVG `feTurbulence` noise pass in `overlay` blend
  mode, keeping the render and the type in the same room.
- **Brushed metal** — directional highlights on the materials card, nodding to the machined
  parts in the exploded view.

## Component callouts

Once the explosion settles (from about frame 207), numbered callouts fade in one at a time on
the parts themselves, with a matching legend card in the corner.

**How the dots stay on the parts.** `drawAt()` records the rectangle the frame maps to
(`state.imgRect`) — which is *not* always the viewport, since a cover fit overflows and a
portrait viewport letterboxes. `.hotspots` is positioned and sized to that exact rectangle, so
a dot at `left: 50%; top: 22%` lands on the same point of the product on any screen.
Positions are normalised frame coordinates, so they are resolution-independent.

**The legend** is anchored to the visible part of that rectangle, and the corners are chosen
structurally rather than by measuring text:

- **Desktop → bottom-right.** Every callout dot sits in the left ~59% of the frame, so a
  right-hand legend physically cannot overlap one, however the labels wrap. (This is why it
  is not bottom-left: a 7-card list there climbs up over dots 2, 3 and 6.)
- **Phones → top, below the nav.** The wide shot is letterboxed into a centred band, so the
  space above it is empty and the bottom belongs to the copy. `script.js` offsets by
  `nav.offsetHeight` so the legend never hides behind the fixed header.

On desktop each card is compact by default and reveals its description on hover or focus —
that keeps the legend at ~224px instead of ~400px, so it covers far less of the product.
Expanding upward is safe because the legend is to the right of every dot.

Hovering or focusing a card highlights its dot.

Each entry in `index.html` carries three values:

```html
<li class="hotspot" data-x="0.500" data-y="0.222" data-at="0.862" tabindex="-1">
  <span class="hotspot__no"></span>          <!-- numbered by script.js from the list order -->
  <span class="hotspot__body">
    <strong>Charging lid</strong>
    <em>Snap-fit hinge with twin magnets</em>
  </span>
</li>
```

| Attribute | Meaning |
| --- | --- |
| `data-x`, `data-y` | position on the frame, `0..1` from the top-left |
| `data-at` | scroll progress that reveals this callout |

Two constraints to keep in mind when editing:

- **Order matters.** Numbers are derived from the list order, and reveal times are staggered,
  so keep `data-at` ascending down the list. Current cascade: `0.862 → 0.955`.
- **`data-at` + the fade must stay ≤ 1.** The fade is `0.04` (`fade` in `collectHotspots`), so
  the last callout has to start at `0.96` or earlier or it will never fully appear.
- **Keep every dot in the left two-thirds of the frame.** The desktop legend's position
  assumes it. If you add a callout past `data-x="0.66"`, re-check the layout in a browser.

`test` harness note: the layout was verified by driving headless Chrome over the DevTools
protocol at 984×530, 390×700, 320×568 and 414×896, asserting that no dot's box intersects
the legend's box at the end of the sequence.

To re-measure coordinates, load the settled frames (`ezgif-frame-215` → `240`) and read
positions off them, then re-check that each dot still lands on its part as the parts drift
during those last frames.

## Loader

The loader is a short brand moment: the real Nothing logo forms out of dot-matrix particles,
then resolves into a crisp wordmark while the 240 frames preload underneath.

### The logo asset

The mark is the real Nothing logo — `nothing-logo.png`, fetched from logo.dev for
`nothing.tech` — embedded in `script.js` as a data URI (`LOGO_SRC`). The embed matters:
opened from `file://`, drawing an external image to a canvas taints it and breaks the pixel
reads the animation depends on, while a data URI is same-origin everywhere. The file in the
repo root is the source asset.

The PNG ships as white-on-black with no alpha, so `prepareLogo()` re-mats it before use:

- The backdrop polarity is detected from a corner pixel; every pixel's ink level becomes
  alpha, and the ink is repainted in the loader's mist white.
- The result is trimmed to its bounding box, so fitting and dot-sampling ignore the source's
  square padding.
- The cinematic then uses it twice: sampled into dot-matrix points for the particle
  formation, and drawn at display size for the final resolve.

If the asset ever fails to decode, the same animation falls back to a "NOTHING" wordmark
rasterised from live type — the loader never depends on the asset.

To regenerate the embed after replacing `nothing-logo.png`:

```bash
node -e "const fs=require('fs');const uri='data:image/png;base64,'+fs.readFileSync('nothing-logo.png').toString('base64');let s=fs.readFileSync('script.js','utf8');s=s.replace(/const LOGO_SRC = \"[^\"]*\";/,'const LOGO_SRC = '+JSON.stringify(uri)+';');fs.writeFileSync('script.js',s)"
```

### How it runs

- `startLoaderCinematic()` gives the asset a brief head start (700 ms cap), then adds
  `.is-backed`, which flips the loader dark via `--loader-fg` / `--loader-dim` /
  `--loader-faint` / `--loader-track`.
- The dots settle over ~2.6 s, hold, then fuse into the solid logo at ~3.4 s; the small
  "by Nothing" line is real HTML text that fades in with the resolve.
- On top: a dot-matrix grid (Nothing's house motif), a slow scan pass during the formation
  only, and an edge vignette.
- **Reduced motion skips the cinematic entirely** — the plain loader runs instead, and
  `state.ready` stops the loop the moment the frames are done.



## Scroll reveal

Elements marked `.js-reveal` fade and rise as they come up, staggered by 90 ms down to a
540 ms cap. The hidden state lives behind `html.js-motion`, a class `script.js` only adds when
`prefers-reduced-motion` allows — so no-JS and reduced-motion visitors see the content
outright instead of an invisible section.

## Customising

**Frames** — drop new frames in and update the top of `script.js`:

```js
basePath: window.CMF_FRAMES_BASE || './',  // or './frames/'
prefix: 'ezgif-frame-', ext: '.jpg',
total: 240, pad: 3, startAt: 1,
```

**Pace** — `scrollVhDesktop` / `scrollVhMobile` control how much scrolling the sequence
takes. `lerp` controls how quickly it catches up (higher = snappier). Lengthening the stage
also gives the callout cascade more room at the end.

**Text beats** — each `<article class="beat">` in `index.html` fades in and out between its
`data-in` / `data-out` values, expressed as fractions of total scroll progress:

```html
<article class="beat beat--left" data-in="0.17" data-out="0.35">…</article>
```

The hero uses `data-in="-0.06"` on purpose: a reveal starting at exactly `0` is invisible at
scroll position zero, so the opening headline would not appear until the visitor scrolled.

Add or remove beats freely — `script.js` picks up whatever is in the DOM. Keep them in
ascending order and leave small gaps between beats so the text clears the product.

**Copy** — the `.beat` blocks, the swatches, the `.finish` buttons in `#colours`, the feature
cards and the `#spec-list` block in `index.html` are the only places content lives. A finish's
name and note come from its `data-name` / `data-note`, and its colour from the inline `--c`
on the same button.

**Branding** — the loader brand, nav brand and `<title>` all read `CMF Buds`; `theme-color`
in `index.html` sets the mobile browser chrome to white, matching the main page.

## Where the product details came from

The specs, feature cards and callout descriptions are the real **CMF Buds (1st gen, March
2024)** — sourced, not invented:

| Figure | Value | Source |
| --- | --- | --- |
| Driver | 12.4 mm bio-fibre + TPU diaphragm, Dirac-tuned | GSMArena review; Amazon brand store |
| ANC | Up to 42 dB hybrid, plus transparency | GSMArena; Notebookcheck |
| Bluetooth | 5.3, dual-device pairing | GSMArena; Notebookcheck |
| Codecs | SBC, AAC only | GSMArena |
| Battery | 45 mAh per bud, 460 mAh case | GSMArena |
| Playback | 8 h buds / 35.5 h case (ANC off); 5.6 h / 24 h (ANC on) | GSMArena |
| Charging | USB-C, 10 min = 4 h, no wireless charging | GSMArena |
| Microphones | 4 (two per bud), AI ENC for calls | GSMArena; Notebookcheck |
| Rating | IP54 | Amazon product listing |
| Weight | 4.5 g per bud, 43 g case | GSMArena |
| Case | 54.7 × 54.7 × 22.9 mm, aluminium lanyard dial | GSMArena |
| Colours | Orange, Light Grey, Dark Grey | CMF product listings; Pocket-lint review |

The three colour names follow CMF's own convention, which the rest of the Buds line uses
(Buds 2a: "apart from Light Grey, the device comes in Dark Grey and Orange"). Reviewers
sometimes describe the same finishes as white and black, and some regional listings do too —
worth knowing if you compare against a retailer page.

The **swatch hex values are approximations** read off product photography, not official
values; they carry a `≈` on the page for that reason. Replace them with true values if you
have them.

**Two things to check before publishing:**

1. **This is the base CMF Buds, not the Pro.** The lineup differs materially — Buds Pro 2
   does 43 h with a 60 mAh cell per bud, Buds 2 has 48 dB ANC and an 11 mm PMI driver, and
   Buds 2a pairs a 12.4 mm bio-fibre driver with Ultra Bass 2.0. If this page is for one of
   those, update `#spec-list`, the four feature cards and the seven callouts.
2. **The footage is not this product.** It is an AI-generated render — there is a "Veo"
   watermark in-frame — so the exploded view is a generic TWS assembly rather than real CMF
   Buds internals. The callouts name what is visible and describe it using real CMF specs;
   they do not claim the render depicts the actual construction. The case is stamped
   `CMP 5.1` while real CMF Buds are Bluetooth 5.3, which is why the earlier copy said 5.1.

Earlier drafts carried invented claims — a balanced-armature driver, replaceable cells, a
"repairable build" and a 6 h runtime. CMF do not market the Buds as serviceable, so those
were removed rather than reworded.

**Breakpoints** — `CONFIG.mobileQuery` in `script.js` and the `max-width: 860px` media query
in `styles.css` must stay in sync. The JS reads it via `matchMedia` rather than comparing
`innerWidth`, so the layout logic and the CSS can never disagree about what "mobile" means.

## Notes

- The frame list is built once on load, so a resize across the 768px breakpoint needs a
  reload to switch between the full sequence and the mobile every-2nd-frame pass.
- The HUD counter reports the real source frame number (001 → 240) by mapping the sequence
  index back through `state.numbers`. On phones, where every other frame is skipped, the
  index alone would only ever reach 121.
- `prefers-reduced-motion` disables the lerp (instant scrubbing), the pulse animation and
  the loader showreel.
- A 25-second safety timeout releases the loader even if something fails to load; any
  missing frames are reported in the loader UI.
