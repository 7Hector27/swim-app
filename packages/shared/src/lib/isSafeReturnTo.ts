/**
 * Returns true only when `value` is a path that is safe to redirect to on
 * the current site.  Rejects open-redirect vectors including:
 *   - Protocol-relative URLs  (//evil.com)
 *   - Raw or percent-encoded backslashes  (\evil.com, %5Cevil.com)
 *   - ASCII control characters
 *   - Any value whose parsed origin differs from siteOrigin
 */
export function isSafeReturnTo(value: string, siteOrigin: string): boolean {
  if (typeof value !== "string") return false;
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\\]|[\x00-\x1f\x7f]/.test(value)) return false;
  try {
    if (/[\\]/.test(decodeURIComponent(value))) return false;
  } catch {
    return false;
  }
  try {
    const parsed = new URL(value, siteOrigin);
    return parsed.origin === siteOrigin;
  } catch {
    return false;
  }
}
