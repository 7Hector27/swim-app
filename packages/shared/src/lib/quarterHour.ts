// Single source of truth for the step size enforced on availability time
// fields (seasons, overrides, default hours). Both the server-side Zod
// refine and the client-side <TimeSelect> read from here, so changing the
// step only needs editing one file.
export const QUARTER_HOUR_MINUTES = [0, 15, 30, 45] as const;

export function isQuarterHour(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23) return false;
  return (QUARTER_HOUR_MINUTES as readonly number[]).includes(minute);
}
