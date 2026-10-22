// Copy helpers shared by every template. Keeps grammar logic (list
// joining, coach-vs-household fallback) in one place and testable.

export function formatSwimmerList(names: readonly string[]): string {
  if (names.length === 0) return "your swimmer";
  if (names.length === 1) return names[0] ?? "your swimmer";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function coachDisplay(coachFirstName: string | null): string {
  return coachFirstName && coachFirstName.length > 0 ? coachFirstName : "The coach";
}
