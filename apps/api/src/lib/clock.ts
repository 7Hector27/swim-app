// Clock seam for the slot engine and booking routes. Production code calls
// nowUtc() wherever it used to call `new Date()` for "now". Tests can pin
// the clock to a specific instant via __setClockForTests so integration
// specs that assert "near this time" are deterministic regardless of when
// they run on the wall clock.

let override: Date | null = null;

export function nowUtc(): Date {
  return override === null ? new Date() : new Date(override.getTime());
}

export function __setClockForTests(instant: Date | null): void {
  override = instant === null ? null : new Date(instant.getTime());
}
