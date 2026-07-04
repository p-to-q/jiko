import React from "react";
import ReactDOM from "react-dom/client";
import brandWordmark from "./assets/jiko-wordmark-site.svg";
import ptoqLogo from "./assets/ptoq-logo.png";
import { ShowcaseStage } from "./ui/ShowcaseStage";
import "./styles.css";
import "./showcase.css";
import "./site.css";

const waitlistCountStorageKey = "jiko.waitlistCount";

const siteRevealTiming = {
  hardwarePauseMs: 480,
  fallbackMs: 4200,
} as const;

const frameDotArrowMotion = {
  startY: 11,
  centerY: 0,
  exitY: -17,
  approachMs: 340,
  departMs: 380,
  rightDelayMs: 90,
  easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
} as const;

const freeWillHoverState = { hovering: false };

type FrameDotFlight = {
  phase: "idle" | "approach" | "centered" | "depart";
  approachAnim?: Animation;
  departAnim?: Animation;
  approachTimer?: number;
};

function prefersReducedSiteMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getFrameDotArrow(dot: HTMLSpanElement) {
  return dot.querySelector<SVGSVGElement>(".site-frame-bottom-dot-arrow");
}

function resetFrameDotArrow(arrow: SVGSVGElement) {
  arrow.style.removeProperty("transform");
  arrow.style.removeProperty("opacity");
}

function frameDotArrowTransform(y: number) {
  return `translate(-50%, -50%) translateY(${y}px)`;
}

function startFrameDotDepart(dot: HTMLSpanElement, flight: FrameDotFlight, startY: number) {
  const arrow = getFrameDotArrow(dot);
  if (!arrow) {
    return;
  }

  if (flight.approachTimer) {
    window.clearTimeout(flight.approachTimer);
    flight.approachTimer = undefined;
  }

  flight.approachAnim?.cancel();
  flight.phase = "depart";

  if (prefersReducedSiteMotion()) {
    flight.phase = "idle";
    resetFrameDotArrow(arrow);
    return;
  }

  flight.departAnim = arrow.animate(
    [
      { transform: frameDotArrowTransform(startY), opacity: 1 },
      { transform: frameDotArrowTransform(frameDotArrowMotion.exitY), opacity: 0 },
    ],
    {
      duration: frameDotArrowMotion.departMs,
      easing: frameDotArrowMotion.easing,
      fill: "forwards",
    },
  );

  flight.departAnim.onfinish = () => {
    flight.phase = "idle";
    flight.departAnim = undefined;
    resetFrameDotArrow(arrow);
  };
}

function startFrameDotFlyThrough(dot: HTMLSpanElement, flight: FrameDotFlight, delay = 0) {
  const arrow = getFrameDotArrow(dot);
  if (!arrow || prefersReducedSiteMotion()) {
    return;
  }

  // Cancel any existing animations
  if (flight.approachTimer) {
    window.clearTimeout(flight.approachTimer);
    flight.approachTimer = undefined;
  }
  flight.approachAnim?.cancel();
  flight.departAnim?.cancel();

  flight.approachTimer = window.setTimeout(() => {
    flight.approachTimer = undefined;
    flight.phase = "depart";

    // Step 1: current arrow exits upward
    flight.departAnim = arrow.animate(
      [
        { transform: frameDotArrowTransform(frameDotArrowMotion.centerY), opacity: 1 },
        { transform: frameDotArrowTransform(frameDotArrowMotion.exitY), opacity: 0 },
      ],
      {
        duration: 220,
        easing: frameDotArrowMotion.easing,
        fill: "forwards",
      },
    );

    flight.departAnim.onfinish = () => {
      flight.departAnim = undefined;
      flight.phase = "approach";

      // Step 2: new arrow enters from below and settles at center
      flight.approachAnim = arrow.animate(
        [
          { transform: frameDotArrowTransform(frameDotArrowMotion.startY), opacity: 0 },
          { transform: frameDotArrowTransform(frameDotArrowMotion.centerY), opacity: 1 },
        ],
        {
          duration: 280,
          easing: frameDotArrowMotion.easing,
          fill: "forwards",
        },
      );

      flight.approachAnim.onfinish = () => {
        flight.approachAnim = undefined;
        flight.phase = "centered";
        arrow.style.transform = frameDotArrowTransform(frameDotArrowMotion.centerY);
        arrow.style.opacity = "1";
      };
    };
  }, delay);
}

function startFrameDotApproach(dot: HTMLSpanElement, flight: FrameDotFlight, delay = 0) {
  const arrow = getFrameDotArrow(dot);
  if (!arrow) {
    return;
  }

  if (flight.approachTimer) {
    window.clearTimeout(flight.approachTimer);
  }

  flight.departAnim?.cancel();
  flight.approachAnim?.cancel();
  flight.approachTimer = window.setTimeout(() => {
    flight.approachTimer = undefined;
    flight.phase = "approach";

    if (prefersReducedSiteMotion()) {
      flight.phase = "idle";
      resetFrameDotArrow(arrow);
      return;
    }

    flight.approachAnim = arrow.animate(
      [
        { transform: frameDotArrowTransform(frameDotArrowMotion.startY), opacity: 1 },
        { transform: frameDotArrowTransform(frameDotArrowMotion.centerY), opacity: 1 },
      ],
      {
        duration: frameDotArrowMotion.approachMs,
        easing: frameDotArrowMotion.easing,
        fill: "forwards",
      },
    );

    flight.approachAnim.onfinish = () => {
      flight.approachAnim = undefined;
      if (freeWillHoverState.hovering) {
        flight.phase = "centered";
        return;
      }

      startFrameDotDepart(dot, flight, frameDotArrowMotion.centerY);
    };
  }, delay);
}

function Site() {
  const ptoqLogoStyle = {
    "--ptoq-logo": `url(${ptoqLogo})`,
  } as React.CSSProperties;
  const [email, setEmail] = React.useState("");
  const [waitlistOpen, setWaitlistOpen] = React.useState(false);
  const [waitlistStatus, setWaitlistStatus] = React.useState<"idle" | "pending" | "success" | "error">("idle");
  const [waitlistCount, setWaitlistCount] = React.useState(readInitialWaitlistCount);
  const [waitlistSuccessText, setWaitlistSuccessText] = React.useState("YOU'RE IN!");
  const [revealReady, setRevealReady] = React.useState(false);
  const revealStartedRef = React.useRef(false);
  const waitlistLabel = formatWaitlistLabel(waitlistCount);
  const waitlistAriaLabel = `JOIN WAITLIST WITH ${waitlistCount} TASTEFUL PEOPLE`;
  const waitlistInputRef = React.useRef<HTMLInputElement>(null);
  const frameBottomDotLeftRef = React.useRef<HTMLSpanElement>(null);
  const frameBottomDotRightRef = React.useRef<HTMLSpanElement>(null);
  const frameDotFlightsRef = React.useRef<{ left: FrameDotFlight; right: FrameDotFlight }>({
    left: { phase: "idle" },
    right: { phase: "idle" },
  });
  const comboRef = React.useRef({ count: 0, timer: 0 });
  const freeWillRef = React.useRef<HTMLButtonElement>(null);
  const triggerCelebration = React.useCallback(() => {
    window.dispatchEvent(new Event("jiko:celebrate"));
    const combo = comboRef.current;
    combo.count++;
    clearTimeout(combo.timer);
    combo.timer = window.setTimeout(() => {
      combo.count = 0;
      if (freeWillRef.current) {
        freeWillRef.current.style.filter = "";
      }
    }, 1200);

    // Fly-through arrows on each click
    const leftDot = frameBottomDotLeftRef.current;
    const rightDot = frameBottomDotRightRef.current;
    if (leftDot) {
      startFrameDotFlyThrough(leftDot, frameDotFlightsRef.current.left, 0);
    }
    if (rightDot) {
      startFrameDotFlyThrough(rightDot, frameDotFlightsRef.current.right, frameDotArrowMotion.rightDelayMs);
    }

    // Screen shake every click
    const frame = document.querySelector(".site-frame") as HTMLElement | null;
    if (frame) {
      const intensity = Math.min(1 + combo.count * 0.4, 4);
      frame.style.setProperty("--shake-intensity", `${intensity}px`);
      frame.classList.remove("site-shaking");
      void frame.offsetWidth; // force reflow to restart animation
      frame.classList.add("site-shaking");
    }

    // Blur "free will" — animate toward target blur
    if (combo.count >= 2 && freeWillRef.current) {
      const targetBlur = Math.min((combo.count - 1) * 1.2, 8);
      freeWillRef.current.style.filter = `blur(${targetBlur}px)`;
    }
  }, []);
  const beginSiteReveal = React.useCallback(() => {
    if (revealStartedRef.current) {
      return;
    }

    revealStartedRef.current = true;
    window.setTimeout(() => {
      setRevealReady(true);
    }, siteRevealTiming.hardwarePauseMs);
  }, []);
  React.useEffect(() => {
    const fallbackTimer = window.setTimeout(() => {
      beginSiteReveal();
    }, siteRevealTiming.fallbackMs);

    return () => {
      window.clearTimeout(fallbackTimer);
    };
  }, [beginSiteReveal]);
  // Idle nudge: flash waitlist arrow circle green to remind user about waitlist
  React.useEffect(() => {
    if (!revealReady || waitlistOpen) return;

    // Wait for waitlist bar to fully expand (start delay 1.45s + unfold 1.8s) + 1s extra
    const expandCompleteMs = 4300;
    const nudgeIntervals = [8000, 6000, 4000];
    const steadyInterval = 8000;
    let round = 0;
    let timer: number | undefined;

    function triggerNudge() {
      const btn = document.querySelector<HTMLElement>(".site-waitlist-front-right");
      if (!btn) return;

      btn.classList.add("nudge");

      const cleanup = () => {
        btn.classList.remove("nudge");
        btn.removeEventListener("animationend", cleanup);
        round++;
        scheduleNudge();
      };
      btn.addEventListener("animationend", cleanup, { once: true });
    }

    function scheduleNudge() {
      const delay = round < nudgeIntervals.length ? nudgeIntervals[round] : steadyInterval;
      timer = window.setTimeout(triggerNudge, delay);
    }

    // First nudge right after expand completes
    timer = window.setTimeout(triggerNudge, expandCompleteMs);

    return () => {
      if (timer) window.clearTimeout(timer);
      const btn = document.querySelector<HTMLElement>(".site-waitlist-front-right");
      if (btn) btn.classList.remove("nudge");
    };
  }, [revealReady, waitlistOpen]);
  const beginFrameBottomArrows = React.useCallback(() => {
    freeWillHoverState.hovering = true;

    const leftDot = frameBottomDotLeftRef.current;
    const rightDot = frameBottomDotRightRef.current;

    if (leftDot) {
      startFrameDotApproach(leftDot, frameDotFlightsRef.current.left, 0);
    }

    if (rightDot) {
      startFrameDotApproach(rightDot, frameDotFlightsRef.current.right, frameDotArrowMotion.rightDelayMs);
    }
  }, []);
  const releaseFrameBottomArrows = React.useCallback(() => {
    freeWillHoverState.hovering = false;

    const pairs = [
      [frameBottomDotLeftRef.current, frameDotFlightsRef.current.left] as const,
      [frameBottomDotRightRef.current, frameDotFlightsRef.current.right] as const,
    ];

    for (const [dot, flight] of pairs) {
      if (!dot) {
        continue;
      }

      if (flight.approachTimer) {
        window.clearTimeout(flight.approachTimer);
        flight.approachTimer = undefined;
      }

      if (flight.phase === "depart") {
        continue;
      }

      if (flight.phase === "centered") {
        startFrameDotDepart(dot, flight, frameDotArrowMotion.centerY);
        continue;
      }

      if (flight.phase === "approach" && flight.approachAnim) {
        const progress = Math.min(1, (Number(flight.approachAnim.currentTime) || 0) / frameDotArrowMotion.approachMs);
        const startY =
          frameDotArrowMotion.startY +
          (frameDotArrowMotion.centerY - frameDotArrowMotion.startY) * progress;
        startFrameDotDepart(dot, flight, startY);
      }
    }
  }, []);
  React.useEffect(() => {
    if (!waitlistOpen || waitlistStatus === "success") {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      waitlistInputRef.current?.focus();
    }, 520);

    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [waitlistOpen, waitlistStatus]);
  React.useEffect(() => {
    if (waitlistStatus !== "success") {
      return;
    }

    setWaitlistSuccessText("YOU'RE IN!");

    const thankYouTimer = window.setTimeout(() => {
      setWaitlistSuccessText("THANK YOU!!");
    }, 1200);
    const successTimer = window.setTimeout(() => {
      setWaitlistOpen(false);
      setWaitlistStatus("idle");
      setWaitlistSuccessText("YOU'RE IN!");
    }, 2800);

    return () => {
      window.clearTimeout(thankYouTimer);
      window.clearTimeout(successTimer);
    };
  }, [waitlistStatus]);
  React.useEffect(() => {
    if (waitlistStatus !== "error") {
      return;
    }

    const errorTimer = window.setTimeout(() => {
      setWaitlistStatus("idle");
    }, 1500);

    return () => {
      window.clearTimeout(errorTimer);
    };
  }, [waitlistStatus]);
  React.useEffect(() => {
    let isCurrent = true;

    async function loadWaitlistCount() {
      try {
        const response = await fetch("/api/waitlist", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const result: unknown = await response.json().catch(() => undefined);
        const nextCount = objectValue(result)?.waitlistCount;
        if (isCurrent) {
          applyWaitlistCount(nextCount, setWaitlistCount);
        }
      } catch {
        // Local Vite previews do not serve Vercel functions; keep the last known count.
      }
    }

    void loadWaitlistCount();

    return () => {
      isCurrent = false;
    };
  }, []);
  const submitWaitlist = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!waitlistOpen) {
        setWaitlistOpen(true);
        return;
      }

      if (waitlistStatus === "pending") {
        return;
      }

      const normalizedEmail = normalizeWaitlistInput(email);
      if (!normalizedEmail) {
        setWaitlistStatus("error");
        return;
      }
      const hasValidEmailFormat = isValidWaitlistEmail(normalizedEmail);

      setWaitlistStatus("pending");

      try {
        const response = await fetch("/api/waitlist", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            email: normalizedEmail,
            source: "site",
          }),
        });

        if (!response.ok) {
          if (isLocalWaitlistPreview()) {
            completeWaitlistSubmission({
              hasValidEmailFormat,
              setWaitlistCount,
              setWaitlistStatus,
              setEmail,
              usePreviewFallback: true,
            });
            return;
          }

          setWaitlistStatus("error");
          return;
        }

        const result: unknown = await response.json().catch(() => undefined);
        const payload = objectValue(result);
        const parsedCount = Number(payload?.waitlistCount);

        if (Number.isInteger(parsedCount) && parsedCount >= 0) {
          applyWaitlistCount(parsedCount, setWaitlistCount);
        } else if (isLocalWaitlistPreview()) {
          applyLocalWaitlistFallback(setWaitlistCount);
        } else if (payload?.ok !== true) {
          setWaitlistStatus("error");
          return;
        }

        completeWaitlistSubmission({
          hasValidEmailFormat,
          setWaitlistCount,
          setWaitlistStatus,
          setEmail,
          usePreviewFallback: false,
        });
      } catch {
        if (isLocalWaitlistPreview()) {
          completeWaitlistSubmission({
            hasValidEmailFormat,
            setWaitlistCount,
            setWaitlistStatus,
            setEmail,
            usePreviewFallback: true,
          });
          return;
        }

        setWaitlistStatus("error");
      }
    },
    [email, waitlistOpen, waitlistStatus],
  );

  return (
    <main className="site-shell" aria-label="jiko official site study">
      <section
        className="site-frame"
        data-reveal={revealReady ? "ready" : "pending"}
        aria-label="jiko first view"
      >
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
        <span ref={frameBottomDotLeftRef} className="site-frame-bottom-dot site-frame-bottom-dot-left" aria-hidden="true">
          <FrameDotArrowIcon />
        </span>
        <span ref={frameBottomDotRightRef} className="site-frame-bottom-dot site-frame-bottom-dot-right" aria-hidden="true">
          <FrameDotArrowIcon />
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
                ref={freeWillRef}
                onPointerEnter={beginFrameBottomArrows}
                onPointerLeave={releaseFrameBottomArrows}
                onFocus={(event) => {
                  if (event.currentTarget.matches(":focus-visible")) {
                    beginFrameBottomArrows();
                  }
                }}
                onBlur={releaseFrameBottomArrows}
                onClick={(event) => {
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
          <ShowcaseStage surface="embedded" onReady={beginSiteReveal} />
        </div>
        <form
          className="site-waitlist"
          data-open={waitlistOpen ? "true" : "false"}
          data-state={waitlistStatus}
          aria-label="Join the jiko waitlist"
          noValidate
          onSubmit={submitWaitlist}
        >
          <label className="site-waitlist-label" htmlFor="site-waitlist-email">
            Email
          </label>
          <div className="site-waitlist-flip">
            <div className="site-waitlist-face site-waitlist-face-front" aria-hidden={waitlistOpen}>
              <button
                className="site-waitlist-front"
                type="button"
                tabIndex={waitlistOpen ? -1 : 0}
                onClick={() => {
                  setWaitlistOpen(true);
                  setWaitlistStatus("idle");
                }}
                aria-label={waitlistAriaLabel}
              >
                <span className="site-waitlist-expand-track">
                  <span className="site-waitlist-front-left">
                    <span className="site-waitlist-marquee" aria-hidden="true">
                      <span>{waitlistLabel}</span>
                      <span>{waitlistLabel}</span>
                      <span>{waitlistLabel}</span>
                    </span>
                  </span>
                  <span className="site-waitlist-front-right">
                    <span className="site-waitlist-arrow-circle" aria-hidden="true">
                      <span className="site-waitlist-arrow-track">
                        <WaitlistArrowIcon />
                        <WaitlistArrowIcon />
                      </span>
                    </span>
                  </span>
                </span>
              </button>
            </div>
            <div className="site-waitlist-face site-waitlist-face-back">
              {waitlistStatus === "success" ? (
                <div className="site-waitlist-success" role="status">
                  <span className="site-waitlist-success-left">{waitlistSuccessText}</span>
                  <span className="site-waitlist-success-right" aria-hidden="true">
                    <span className="site-waitlist-arrow-circle">
                      <WaitlistArrowIcon />
                    </span>
                  </span>
                </div>
              ) : (
                <div className="site-waitlist-control">
                  <input
                    id="site-waitlist-email"
                    name="email"
                    ref={waitlistInputRef}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    enterKeyHint="send"
                    placeholder="ENTER YOUR EMAIL"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      if (waitlistStatus !== "pending") {
                        setWaitlistStatus("idle");
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") {
                        return;
                      }

                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }}
                    required
                  />
                  <button
                    type="submit"
                    disabled={waitlistStatus === "pending"}
                    aria-label={waitlistAriaLabel}
                  >
                    <span className="site-waitlist-arrow-track" aria-hidden="true">
                      <WaitlistArrowIcon />
                      <WaitlistArrowIcon />
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </form>
        <a
          className="site-project-credit"
          href="https://www.ptoq.io/"
          target="_blank"
          rel="noreferrer"
          aria-label="a p to q project"
        >
          <span className="site-project-credit-sequence">
            <span className="site-project-credit-a">a</span>
            <span
              className="site-project-credit-logo site-project-credit-logo-reveal"
              style={ptoqLogoStyle}
              aria-label="[p to q]"
            />
            <span className="site-project-credit-project">project</span>
          </span>
        </a>
      </section>
    </main>
  );
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function formatWaitlistLabel(count: number): React.ReactNode {
  return (
    <>
      JOIN WAITLIST WITH <span className="site-waitlist-count">{count}</span> TASTEFUL PEOPLE
    </>
  );
}

function normalizeWaitlistInput(value: string): string | undefined {
  const normalizedValue = value
    .trim()
    .replace(/^mailto:/i, "")
    .replace(/[\u0000-\u001f\u007f\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();

  if (!normalizedValue || normalizedValue.length > 254) {
    return undefined;
  }

  return normalizedValue;
}

function isValidWaitlistEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isLocalWaitlistPreview(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const hostname = window.location.hostname;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function completeWaitlistSubmission({
  hasValidEmailFormat,
  setWaitlistCount,
  setWaitlistStatus,
  setEmail,
  usePreviewFallback,
}: {
  hasValidEmailFormat: boolean;
  setWaitlistCount: React.Dispatch<React.SetStateAction<number>>;
  setWaitlistStatus: React.Dispatch<React.SetStateAction<"idle" | "pending" | "success" | "error">>;
  setEmail: React.Dispatch<React.SetStateAction<string>>;
  usePreviewFallback: boolean;
}): void {
  if (usePreviewFallback) {
    applyLocalWaitlistFallback(setWaitlistCount);
  }

  setWaitlistStatus(hasValidEmailFormat ? "success" : "error");
  if (hasValidEmailFormat) {
    setEmail("");
  }
}

function readInitialWaitlistCount(): number {
  if (typeof window === "undefined") {
    return 0;
  }

  try {
    const storedValue = Number(window.localStorage.getItem(waitlistCountStorageKey));
    return Number.isInteger(storedValue) && storedValue >= 0 ? storedValue : 0;
  } catch {
    return 0;
  }
}

function applyWaitlistCount(
  value: unknown,
  setCount: React.Dispatch<React.SetStateAction<number>>,
): void {
  const nextCount = Number(value);
  if (!Number.isInteger(nextCount) || nextCount < 0) {
    return;
  }

  writeStoredWaitlistCount(nextCount);
  setCount(nextCount);
}

function writeStoredWaitlistCount(count: number): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(waitlistCountStorageKey, String(count));
  } catch {
    // Count caching is only a display convenience.
  }
}

function applyLocalWaitlistFallback(
  setCount: React.Dispatch<React.SetStateAction<number>>,
): void {
  setCount((currentCount) => {
    const fallbackCount = currentCount + 1;
    writeStoredWaitlistCount(fallbackCount);
    return fallbackCount;
  });
}

function FrameDotArrowIcon() {
  return (
    <svg
      className="site-frame-bottom-dot-arrow"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.25"
      focusable="false"
      aria-hidden="true"
    >
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

function WaitlistArrowIcon() {
  return (
    <svg
      className="site-waitlist-arrow-icon"
      viewBox="0 0 24 24"
      fill="currentColor"
      focusable="false"
      aria-hidden="true"
    >
      <path d="M11 4.17a1 1 0 0 1 1.41 0l6.72 6.71a1 1 0 0 1-1.42 1.42L13 7.59V19a1 1 0 1 1-2 0V7.59L6.29 12.3a1 1 0 0 1-1.42-1.42L11 4.17Z" />
    </svg>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Site />
  </React.StrictMode>,
);
