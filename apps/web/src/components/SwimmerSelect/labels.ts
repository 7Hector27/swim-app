// Shared helpers for the coach-only swimmer picker on the meet detail page.
// Keeping the disambiguation logic in a plain module (no "use client"
// directive) lets the unit tests exercise it without React state and lets
// server components use it too if they ever need the same label.

export interface DisambigSwimmer {
  id: string;
  firstName: string;
  lastName: string;
  age: number;
  householdName: string;
  // "YYYY-MM" — used only when first/last/age collision + householdName
  // collision still leaves two swimmers indistinguishable.
  birthMonthYear: string;
}

// Case-insensitive, trim-insensitive full-name key so "Alex Smith" and
// "alex  smith " collapse into the same group.
function fullNameKey(swimmer: DisambigSwimmer): string {
  return `${swimmer.firstName.trim()} ${swimmer.lastName.trim()}`.toLowerCase();
}

function householdKey(swimmer: DisambigSwimmer): string {
  return swimmer.householdName.trim().toLowerCase();
}

function formatMonthYear(birthMonthYear: string): string {
  // "2013-01" → "January 2013"
  const match = /^(\d{4})-(\d{2})$/.exec(birthMonthYear);
  if (!match) return birthMonthYear;
  const [, yearStr, monthStr] = match;
  const monthIndex = Number(monthStr) - 1;
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const name = months[monthIndex] ?? monthStr;
  return `${name} ${yearStr}`;
}

// Alphabetical by first name then last name.
export function sortSwimmers<T extends DisambigSwimmer>(swimmers: T[]): T[] {
  return [...swimmers].sort((a, b) => {
    const firstCompare = a.firstName.localeCompare(b.firstName);
    if (firstCompare !== 0) return firstCompare;
    return a.lastName.localeCompare(b.lastName);
  });
}

// Build a visible label for every swimmer in the list. When two or more share
// a first+last name, their labels also include " · <Household> family". If
// household names still collide, labels add " · <Month> <Year>".
export function buildSwimmerLabels<T extends DisambigSwimmer>(
  swimmers: T[],
): Map<string, string> {
  const labels = new Map<string, string>();

  const byName = new Map<string, T[]>();
  for (const swimmer of swimmers) {
    const key = fullNameKey(swimmer);
    const bucket = byName.get(key) ?? [];
    bucket.push(swimmer);
    byName.set(key, bucket);
  }

  for (const bucket of byName.values()) {
    if (bucket.length === 1) {
      const only = bucket[0]!;
      labels.set(only.id, `${only.firstName} ${only.lastName} · Age ${only.age}`);
      continue;
    }

    // Name collision: group by household next.
    const byHousehold = new Map<string, T[]>();
    for (const swimmer of bucket) {
      const key = householdKey(swimmer);
      const list = byHousehold.get(key) ?? [];
      list.push(swimmer);
      byHousehold.set(key, list);
    }

    for (const hbucket of byHousehold.values()) {
      if (hbucket.length === 1) {
        const only = hbucket[0]!;
        labels.set(
          only.id,
          `${only.firstName} ${only.lastName} · Age ${only.age} · ${only.householdName} family`,
        );
        continue;
      }

      // Household collision too: fall back to birth month/year.
      for (const swimmer of hbucket) {
        labels.set(
          swimmer.id,
          `${swimmer.firstName} ${swimmer.lastName} · Age ${swimmer.age} · ${swimmer.householdName} family · ${formatMonthYear(swimmer.birthMonthYear)}`,
        );
      }
    }
  }

  return labels;
}
