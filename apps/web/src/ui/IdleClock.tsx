import { useEffect, useState } from "react";
import { DotMatrix } from "./DotMatrix";

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

type BatteryState = {
  level: number; // 0..1
  charging: boolean;
  known: boolean;
};

// Idle/ambient face for the top strip: a dot-matrix clock, calendar, and battery.
// This is the device's resting machine-state. During recording, processing, and
// result the strip reverts to its title/status role.
export function IdleClock() {
  const [clockStart] = useState(resolveClockStart);
  const now = useClock(clockStart, resolveClockNow());
  const battery = useBattery();
  const colon = resolveColonState();

  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const weekday = WEEKDAYS[now.getDay()];
  const date = `${MONTHS[now.getMonth()]} ${now.getDate()}`;

  return (
    <div className="idle-clock">
      <DotMatrix
        className="clock-time"
        text={`${hours}:${minutes}`}
        dot={5}
        gap={1}
        tracking={1}
        ariaLabel={`${hours}:${minutes}`}
        data-colon={colon}
      />
      <div className="clock-meta">
        <DotMatrix className="clock-weekday" text={weekday} dot={2} gap={0} tracking={1} />
        <DotMatrix className="clock-date" text={date} dot={2} gap={0} tracking={1} />
        <BatteryGlyph level={battery.level} charging={battery.charging} />
      </div>
    </div>
  );
}

function BatteryGlyph({ level, charging }: { level: number; charging: boolean }) {
  const clamped = Math.max(0, Math.min(1, level));
  const bars = Math.round(clamped * 3); // 0..3 filled segments
  const label = `${Math.round(clamped * 100)}%${charging ? " charging" : ""}`;

  return (
    <span
      className="battery"
      data-charging={charging ? "true" : "false"}
      role="img"
      aria-label={`Battery ${label}`}
    >
      <span className="battery-shell">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="battery-bar"
            data-filled={index < bars ? "true" : "false"}
          />
        ))}
      </span>
      <span className="battery-cap" aria-hidden="true" />
    </span>
  );
}

// Ticks once per second so minute and date rollovers land within ~1s. The colon
// blink is handled in CSS, so re-renders stay cheap.
function useClock(start?: Date, fixed?: Date): Date {
  const [now, setNow] = useState(() => fixed ?? start ?? new Date());

  useEffect(() => {
    if (fixed) {
      setNow(fixed);
      return;
    }

    const startedAt = Date.now();
    const id = window.setInterval(
      () => setNow(start ? new Date(start.getTime() + Date.now() - startedAt) : new Date()),
      1000,
    );
    return () => window.clearInterval(id);
  }, [start, fixed]);

  return now;
}

function resolveClockStart(): Date | undefined {
  const value = new URLSearchParams(window.location.search).get("clockStart");
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function resolveClockNow(): Date | undefined {
  const value = new URLSearchParams(window.location.search).get("clockNow");
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function resolveColonState(): "on" | "off" | undefined {
  const value = new URLSearchParams(window.location.search).get("colon");
  return value === "on" || value === "off" ? value : undefined;
}

// Reads the browser Battery Status API where available (Chromium kiosk on the Pi
// supports it). On Safari/Firefox the API is absent, so we report a full,
// non-charging cell until the hardware adapter feeds a real value.
function useBattery(): BatteryState {
  const [state, setState] = useState<BatteryState>({
    level: 1,
    charging: false,
    known: false,
  });

  useEffect(() => {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<BatteryManagerLike>;
    };

    if (typeof nav.getBattery !== "function") {
      return;
    }

    let manager: BatteryManagerLike | undefined;
    let active = true;

    const apply = () => {
      if (manager) {
        setState({ level: manager.level, charging: manager.charging, known: true });
      }
    };

    nav
      .getBattery()
      .then((battery) => {
        if (!active) {
          return;
        }

        manager = battery;
        apply();
        battery.addEventListener("levelchange", apply);
        battery.addEventListener("chargingchange", apply);
      })
      .catch(() => {
        // Keep the safe default if the API rejects.
      });

    return () => {
      active = false;
      if (manager) {
        manager.removeEventListener("levelchange", apply);
        manager.removeEventListener("chargingchange", apply);
      }
    };
  }, []);

  return state;
}

type BatteryManagerLike = {
  level: number;
  charging: boolean;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};
