// ADR 034 made the identity columns on `lessons` nullable at the schema
// level so anonymized past-lesson rows (anonymizedAt set) can survive the
// deletion of their household. Every live-lesson code path operates on
// rows whose anonymizedAt is null — either by filtering explicitly, by
// reading inside a transaction that locks before any anonymization runs,
// or because the row was just inserted. For those paths the nulls can
// never appear at runtime; these helpers assert the invariant at the
// query boundary and narrow the type back to non-null.
//
// Call at the point of leaving the DB — `.map(requireLiveLessonFields)`
// on a lesson select — so the rest of the function works with a narrowed
// shape and a new anonymized-row leak surfaces as a loud throw, not a
// silent type confusion later.

export function requireLiveLessonFields<
  T extends { householdId: string | null; locationId: string | null },
>(row: T): T & { householdId: string; locationId: string } {
  if (row.householdId === null) {
    throw new Error("requireLiveLessonFields: householdId is null (anonymized row leaked)");
  }
  if (row.locationId === null) {
    throw new Error("requireLiveLessonFields: locationId is null (anonymized row leaked)");
  }
  return row as T & { householdId: string; locationId: string };
}

export function requireLiveLocationId<T extends { locationId: string | null }>(
  row: T,
): T & { locationId: string } {
  if (row.locationId === null) {
    throw new Error("requireLiveLocationId: locationId is null (anonymized row leaked)");
  }
  return row as T & { locationId: string };
}

export function requireLiveHouseholdId<T extends { householdId: string | null }>(
  row: T,
): T & { householdId: string } {
  if (row.householdId === null) {
    throw new Error("requireLiveHouseholdId: householdId is null (anonymized row leaked)");
  }
  return row as T & { householdId: string };
}
