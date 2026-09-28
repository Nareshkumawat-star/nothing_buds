import { useEffect, useState } from "react";
import GlyphPortal, { type GlyphPortalStyle } from "@/components/ui/glyph-portal";

/* ---------------------------------------------------------------------------
 * Landing = the Glyph Portal sequence. The word "NOTHING" fills a white stage;
 * pick a letter (the O by default) and scroll to fall through it. The backdrop
 * behind the word is black/copper — the green default is overridden on purpose.
 * When the dive finishes, the buds animation site follows immediately (static
 * markup in index.html, driven by script.js).
 * ------------------------------------------------------------------------- */

const settings = {
  word: "NOTHING",
  /* fall through the O — the classic portal letter */
  focusChar: "O",
  scrollLength: 2.4,
  interactive: true,
  annotations: false,
};
const family = '"Glyph Portal Jakarta", Arial, sans-serif';

let fontLoad: Promise<void> | undefined;

/* Self-hosted copy of the demo face (public/fonts) — the original CDN does not
   send CORS headers, so the FontFace load would always fail cross-origin. */

export default function GlyphLanding() {
  const [face, setFace] = useState<string | null>(null);

  useEffect(() => {
    let settled = false;
    const finish = (value: string) => {
      if (!settled) {
        settled = true;
        setFace(value);
      }
    };
    // The component itself never fetches a font; the demo preloads its face.
    fontLoad ??= new FontFace(
      "Glyph Portal Jakarta",
      'url("fonts/glyph-portal-jakarta.woff2")',
      { weight: "400 700" },
    )
      .load()
      .then((font) => {
        document.fonts.add(font);
      });
    const timeout = window.setTimeout(() => finish("Arial, sans-serif"), 1600);
    void fontLoad.then(() => finish(family), () => finish("Arial, sans-serif"));
    return () => {
      settled = true;
      clearTimeout(timeout);
    };
  }, []);

  return (
    <div
      data-slipstream-demo
      role="region"
      aria-label="Nothing. Scroll to step inside."
      style={{
        width: "100%",
        minHeight: "100svh",
        background: "#fff",
        containerType: "inline-size",
        fontFamily: face ?? "Arial, sans-serif",
      }}
    >
      <style>{`
        [data-slipstream-demo] [data-gp-caption]{inset:calc(var(--gp-word-bottom,50%) + 82px) 24px auto;justify-content:center;}
        [data-slipstream-demo] [data-gp-hint]{display:none;}
        [data-slipstream-demo] [data-gp-enter]{min-height:46px;padding:0 20px;gap:28px;background:#0a0a0b;border:1px solid #0a0a0b;border-radius:10px;color:#fff;font-size:13px;font-weight:500;box-shadow:0 1px 2px #0a0a0b1a;transition:background .18s,box-shadow .18s;}
        [data-slipstream-demo] [data-gp-enter]:hover{background:#1c1d1f;box-shadow:0 3px 8px #0a0a0b18;}
        [data-slipstream-demo] [data-gp-enter]:focus-visible{outline:2px solid #c4793c;outline-offset:4px;}
        [data-slipstream-demo] [data-gp-touch-picker]{top:auto;bottom:18px;left:50%;}
        [data-slipstream-demo] [data-gp-select]{border-color:transparent;border-radius:8px;font-size:12px;color:#626964;}
        [data-portal-header]{position:absolute;inset:clamp(24px,4.5cqw,48px) clamp(24px,5cqw,64px) auto;display:flex;align-items:center;justify-content:space-between;gap:20px;}
        [data-portal-logo]{font-size:19px;font-weight:600;letter-spacing:-.065em;color:#0a0a0b;}
        [data-portal-category]{font-size:12px;line-height:1.5;color:#71766f;}
        [data-portal-eyebrow]{position:absolute;inset:auto 24px calc(100% - var(--gp-word-top,35%) + 32px);margin:0;text-align:center;font-size:13px;font-weight:400;line-height:1.5;letter-spacing:.005em;color:#71766f;}
        [data-portal-support]{position:absolute;inset:calc(var(--gp-word-bottom,50%) + 32px) 24px auto;margin:0;text-align:center;font-size:16px;font-weight:400;line-height:1.5;color:#646a63;}
        [data-portal-scroll]{position:absolute;inset:auto 24px 7%;text-align:center;color:#7c817b;font-size:11px;letter-spacing:.01em;}
        @media(any-pointer:coarse){[data-portal-scroll]{bottom:13%;}}
        @container(max-width:450px){[data-portal-category]{max-width:12ch;text-align:right;}[data-portal-eyebrow]{font-size:12px;}[data-portal-support]{font-size:14px;}[data-slipstream-demo] [data-gp-caption]{top:calc(var(--gp-word-bottom,50%) + 76px);}}
        @container(max-height:479px){[data-portal-header]{top:18px;}[data-portal-support]{top:calc(var(--gp-word-bottom,50%) + 16px);}[data-slipstream-demo] [data-gp-caption]{top:calc(var(--gp-word-bottom,50%) + 60px);}[data-portal-scroll]{display:none;}}
        [data-slipstream-demo] [data-gp-content]{padding:0;}
      `}</style>
      {face ? (
        <GlyphPortal
          word={settings.word}
          fontFamily={face}
          fontWeight={700}
          style={{ fontFamily: face, "--gp-field": "#0a0a0b" } as GlyphPortalStyle}
          scrollLength={settings.scrollLength}
          interactive={settings.interactive}
          annotations={settings.annotations}
          focusChar={settings.focusChar}
          enterLabel="Step inside"
          /* Black/copper product backdrop — replaces the component's green default. */
          background={
            <div
              style={{
                position: "absolute",
                inset: 0,
                transform: "scale(var(--gp-field-scale,1))",
                background:
                  "radial-gradient(circle at 20% 10%, rgba(196,121,60,.30), transparent 42%), radial-gradient(circle at 82% 86%, rgba(196,121,60,.16), transparent 46%), radial-gradient(circle at 50% 50%, rgba(231,233,236,.06), transparent 55%), linear-gradient(135deg,#0a0a0b 0%,#17191c 55%,#050506 100%)",
              }}
            />
          }
          front={
            <>
              <div data-portal-header>
                <span data-portal-logo>nothing.</span>
                <span data-portal-category>CMF Buds — True Wireless</span>
              </div>
              <p data-portal-eyebrow>A different perspective starts here.</p>
              <p data-portal-support>Follow your curiosity.</p>
              <span data-portal-scroll>Scroll for a closer look ↓</span>
            </>
          }
        />
      ) : (
        <div
          role="status"
          style={{ height: "100%", display: "grid", placeItems: "center", color: "#555", fontSize: 12 }}
        >
          Loading type…
        </div>
      )}
    </div>
  );
}
