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

// Integer-cents → `$X.YY` for email body copy. Emails are plain-text to
// a human, so no locale awareness or sign prefix is needed (the sign is
// always implicit from context — "Refunded $X. New balance: $Y.").
export function formatMoneyCents(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${dollars.toLocaleString("en-US")}.${String(remainder).padStart(2, "0")}`;
}

// Single line the refund-emitting templates render when a refund actually
// landed in the same transaction. Both arguments are nullable — null on
// either means no refund (free lesson, pre-Phase-4 row, or an already-
// refunded charge). Returns null so callers can `return refundSentence(...)
// && <Text>…</Text>` cleanly.
export function refundSentence(
  refundAmountCents: number | null,
  newBalanceCents: number | null,
): string | null {
  if (refundAmountCents === null || newBalanceCents === null) return null;
  if (refundAmountCents <= 0) return null;
  return `Refunded ${formatMoneyCents(refundAmountCents)}. New balance: ${formatMoneyCents(
    newBalanceCents,
  )}.`;
}
