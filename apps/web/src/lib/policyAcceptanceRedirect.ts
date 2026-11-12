// Client-side redirect when a gated write returns 409
// policy_acceptance_required (ADR 036 Phase 8 Part B Stop 3 piece 3).
// Captures the current pathname + search string as `next` so the
// `/policy-updated` interstitial can send the parent back to the same
// page (the booking screen, the add-funds form, or wherever the
// original write came from) after they accept.

export function redirectToPolicyUpdated(): void {
  const next = window.location.pathname + window.location.search;
  window.location.href = `/policy-updated?next=${encodeURIComponent(next)}`;
}
