import React from "react";
import ReactDOM from "react-dom/client";
import brandWordmark from "./assets/jiko-wordmark.svg";
import ptoqLogo from "./assets/ptoq-logo.png";
import { ShowcaseStage } from "./ui/ShowcaseStage";
import "./styles.css";
import "./showcase.css";
import "./site.css";

function Site() {
  const ptoqLogoStyle = {
    "--ptoq-logo": `url(${ptoqLogo})`,
  } as React.CSSProperties;
  const lastCelebrationAtRef = React.useRef(0);
  const triggerCelebration = React.useCallback(() => {
    const now = performance.now();
    if (now - lastCelebrationAtRef.current < 140) {
      return;
    }

    lastCelebrationAtRef.current = now;
    window.dispatchEvent(new Event("jiko:celebrate"));
  }, []);

  return (
    <main className="site-shell" aria-label="jiko official site study">
      <section className="site-frame" aria-label="jiko first view">
        <span className="site-frame-accent site-frame-accent-left" aria-hidden="true">
          <svg viewBox="0 0 36 36" focusable="false">
            <path d="M 36 1.8 L 36 36 L 1.8 36 Q 0.8 36 0.35 35.1 Q 0 34.2 0.7 33.5 L 33.5 0.7 Q 34.2 0 35.1 0.35 Q 36 0.8 36 1.8 Z" />
          </svg>
        </span>
        <span className="site-frame-accent site-frame-accent-right" aria-hidden="true">
          <svg viewBox="0 0 36 36" focusable="false">
            <path d="M 0 1.8 L 0 36 L 34.2 36 Q 35.2 36 35.65 35.1 Q 36 34.2 35.3 33.5 L 2.5 0.7 Q 1.8 0 0.9 0.35 Q 0 0.8 0 1.8 Z" />
          </svg>
        </span>
        <div className="site-hero-copy">
          <h1>
            <span className="site-title-line site-title-line-brand">
              Meet
              <img className="site-brand-wordmark" src={brandWordmark} alt="Jiko" />
            </span>
            <span className="site-title-line">instant decision making instrument</span>
            <span className="site-title-line">
              that gives your thoughts{" "}
              <span className="site-signal-dots" aria-label="red, yellow, green">
                <span className="site-signal-dot site-signal-dot-red" aria-hidden="true" />
                <span className="site-signal-dot site-signal-dot-yellow" aria-hidden="true" />
                <span className="site-signal-dot site-signal-dot-green" aria-hidden="true" />
              </span>
            </span>
            <span className="site-title-line site-hero-serif">
              And leaves{" "}
              <button
                className="site-free-will"
                type="button"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.blur();
                  triggerCelebration();
                }}
                onPointerUp={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  triggerCelebration();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  triggerCelebration();
                }}
              >
                free will
              </button>{" "}
              intact.
            </span>
          </h1>
        </div>
        <div className="site-hardware-stage" aria-label="jiko hardware">
          <ShowcaseStage surface="embedded" />
        </div>
        <a className="site-project-credit" href="https://www.ptoq.io/" target="_blank" rel="noreferrer">
          <span>a</span>
          <span
            className="site-project-credit-logo"
            style={ptoqLogoStyle}
            role="img"
            aria-label="[p to q]"
          />
          <span>project</span>
        </a>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Site />
  </React.StrictMode>,
);
