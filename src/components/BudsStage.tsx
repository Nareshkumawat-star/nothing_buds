import { useEffect } from "react";

/* ---------------------------------------------------------------------------
 * BudsStage = the classic 240-frame interactive product sequence.
 * Driven by script.js + styles.css, scrubbing through ezgif-frame-001..240.jpg
 * ------------------------------------------------------------------------- */
export default function BudsStage() {
  useEffect(() => {
    if (typeof (window as any).initCmfStage === "function") {
      (window as any).initCmfStage();
    }
  }, []);

  return (
    <>
      <header className="nav" id="nav">
        <div className="nav__brand">
          <span className="nav__dot"></span>
          CMF Buds <span className="nav__model">by Nothing</span>
        </div>
        <nav className="nav__links">
          <a href="#materials">Materials</a>
          <a href="#inside">Inside</a>
          <a href="#specs">Specs</a>
        </nav>
        <a href="#buy" className="nav__cta">
          Buy now
        </a>
      </header>

      <section className="stage" id="stage">
        <div className="stage__pin" id="stage-pin">
          <canvas id="frame-canvas"></canvas>
          <div className="fx fx--grain"></div>
          <div className="fx fx--speckle"></div>
          <div className="fx fx--vignette"></div>

          <div className="beats">
            <article className="beat beat--left" data-in="-0.06" data-out="0.14">
              <span className="beat__eyebrow">
                <i className="dot"></i>CMF Buds by Nothing
              </span>
              <h1 className="beat__title">Sound, engineered.</h1>
              <p className="beat__body">
                A scroll-driven look from the closed case to every component inside.
              </p>
            </article>

            <article className="beat beat--right" data-in="0.16" data-out="0.34">
              <span className="beat__eyebrow">
                <i className="dot"></i>Acoustics
              </span>
              <h2 className="beat__title">12.4 mm bio-fibre driver.</h2>
              <p className="beat__body">
                Ultra Bass Tech 2.0 with custom TPU diaphragm, tuned by Dirac.
              </p>
            </article>

            <article className="beat beat--left" data-in="0.36" data-out="0.54">
              <span className="beat__eyebrow">
                <i className="dot"></i>Active Noise Cancellation
              </span>
              <h2 className="beat__title">42 dB of quiet.</h2>
              <p className="beat__body">
                Hybrid ANC blocks out ambient noise, with instant transparency mode.
              </p>
            </article>

            <article className="beat beat--right" data-in="0.56" data-out="0.74">
              <span className="beat__eyebrow">
                <i className="dot"></i>Clear Calls
              </span>
              <h2 className="beat__title">4 HD mics with AI ENC.</h2>
              <p className="beat__body">
                Wind-proof stem vents cut noise so your voice comes through sharp.
              </p>
            </article>

            <article className="beat beat--center" data-in="0.76" data-out="0.88">
              <span className="beat__eyebrow">
                <i className="dot"></i>Battery &amp; Charge
              </span>
              <h2 className="beat__title">35.5 hours total.</h2>
              <p className="beat__body">
                Up to 8 hours in the buds. 10 minutes USB-C top-up buys 4 hours.
              </p>
            </article>
          </div>

          <div className="hotspots" id="hotspots">
            <ul className="legend" id="legend">
              <li className="hotspot" data-x="0.500" data-y="0.222" data-at="0.862" tabIndex={-1}>
                <span className="hotspot__no">1</span>
                <span className="hotspot__body">
                  <strong>Charging lid</strong>
                  <em>Snap-fit hinge with twin magnets</em>
                </span>
              </li>
              <li className="hotspot" data-x="0.485" data-y="0.340" data-at="0.880" tabIndex={-1}>
                <span className="hotspot__no">2</span>
                <span className="hotspot__body">
                  <strong>Alloy dial</strong>
                  <em>Tactile lanyard attachment wheel</em>
                </span>
              </li>
              <li className="hotspot" data-x="0.440" data-y="0.435" data-at="0.898" tabIndex={-1}>
                <span className="hotspot__no">3</span>
                <span className="hotspot__body">
                  <strong>Inner cradle</strong>
                  <em>Precision moulded earbud seating</em>
                </span>
              </li>
              <li className="hotspot" data-x="0.410" data-y="0.550" data-at="0.916" tabIndex={-1}>
                <span className="hotspot__no">4</span>
                <span className="hotspot__body">
                  <strong>Mainboard &amp; MCU</strong>
                  <em>Bluetooth 5.3 SoC + Dirac DSP</em>
                </span>
              </li>
              <li className="hotspot" data-x="0.460" data-y="0.650" data-at="0.934" tabIndex={-1}>
                <span className="hotspot__no">5</span>
                <span className="hotspot__body">
                  <strong>12.4 mm Bio-driver</strong>
                  <em>Copper voice coil &amp; TPU surround</em>
                </span>
              </li>
              <li className="hotspot" data-x="0.520" data-y="0.740" data-at="0.950" tabIndex={-1}>
                <span className="hotspot__no">6</span>
                <span className="hotspot__body">
                  <strong>Silicone ear tips</strong>
                  <em>Acoustic seal in 3 sizes</em>
                </span>
              </li>
            </ul>
          </div>

          <div className="chip" id="chip">
            Exploded View
          </div>

          <div className="hud">
            <div className="hud__track">
              <div className="hud__fill" id="hud-fill"></div>
            </div>
            <span className="hud__num" id="hud-num">
              001
            </span>
          </div>

          <div className="hint" id="hint">
            Scroll to explore frame by frame
          </div>
        </div>
      </section>
    </>
  );
}
