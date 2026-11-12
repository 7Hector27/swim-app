// Shared footer for the Terms, Privacy, and Payments & Refund policy
// pages. The version string is the canonical publication date in
// YYYY-MM-DD form from @swim-app/shared — same constant signup carries
// in the hidden form input so an acceptance is pinned to the exact
// wording the parent saw. A text edit must bump the version constant
// so existing parents hit the re-acceptance interstitial before their
// next booking or add-funds action (ADR 036 Phase 8 Part B §8).

interface Props {
  version: string;
}

export default function PolicyMeta({ version }: Props) {
  const parts = version.split("-").map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const date = new Date(Date.UTC(year, month - 1, day));
  const formatted = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  return (
    <p className="text-text-secondary mb-10" data-testid="policy-meta">
      Last updated {formatted} · Version {version}
    </p>
  );
}
