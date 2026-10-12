export const PRIVATE_HOURLY_RATE = 120;
export const LESSON_30_MIN = 60;
export const LESSON_45_MIN = 90;

const DISCOUNT_10H = 0.1;
const DISCOUNT_20H = 0.2;

export type PricingRow = {
  swimmers: string;
  perHour: number;
  perPerson: number;
};

export const PRICING_ROWS: PricingRow[] = [
  { swimmers: "1 · Private", perHour: 120, perPerson: 120 },
  { swimmers: "2 siblings",  perHour: 180, perPerson: 90  },
  { swimmers: "3 siblings",  perHour: 198, perPerson: 66  },
  { swimmers: "4 siblings",  perHour: 216, perPerson: 54  },
];

export function tenHourPrice(perHour: number): number {
  return Math.round(perHour * 10 * (1 - DISCOUNT_10H));
}

export function twentyHourPrice(perHour: number): number {
  return Math.round(perHour * 20 * (1 - DISCOUNT_20H));
}

// Convenience constants for private lessons
export const PACKAGE_10H = tenHourPrice(PRIVATE_HOURLY_RATE);
export const PACKAGE_20H = twentyHourPrice(PRIVATE_HOURLY_RATE);
