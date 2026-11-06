import { QUARTER_HOUR_MINUTES } from "@swim-app/shared";

// 24-hour "HH:MM" strings on the step the shared helper enforces, 00:00
// through 23:45. Derived from QUARTER_HOUR_MINUTES so changing the step
// in one place also updates every <TimeSelect>.
export const QUARTER_HOUR_OPTIONS: readonly string[] = (() => {
  const options: string[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (const minute of QUARTER_HOUR_MINUTES) {
      options.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    }
  }
  return options;
})();

export function formatTime12(hhmm: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return hhmm;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${period}`;
}
