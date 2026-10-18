import type { ReactNode } from "react";

import { siteLinks } from "@/lib/siteLinks";

import {
  PRIVATE_HOURLY_RATE,
  LESSON_30_MIN,
  LESSON_45_MIN,
  PACKAGE_10H,
  PACKAGE_20H,
  PRICING_ROWS,
  tenHourPrice,
  twentyHourPrice,
} from "./faqPricing";

export type FaqItem = {
  question: string;
  answer: ReactNode;
};

function usd(n: number): string {
  return "$" + n.toLocaleString("en-US");
}

const txt = "text-text-secondary leading-relaxed text-sm";

function PricingTable() {
  return (
    <div className="overflow-x-auto mt-3 mb-1 rounded-card border border-border">
      <table className="min-w-full text-sm text-text border-collapse">
        <caption className="text-left px-4 py-2 text-xs font-semibold text-text-secondary uppercase tracking-[0.06em] border-b border-border">
          Family lesson pricing
        </caption>
        <thead>
          <tr className="border-b border-border bg-surface-soft">
            <th scope="col" className="px-4 py-2.5 text-left font-semibold whitespace-nowrap">
              Swimmers (same household)
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold whitespace-nowrap">
              Per hour
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold whitespace-nowrap">
              Each
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold whitespace-nowrap">
              10 hours (−10%)
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold whitespace-nowrap">
              20 hours (−20%)
            </th>
          </tr>
        </thead>
        <tbody>
          {PRICING_ROWS.map((row) => (
            <tr key={row.swimmers} className="border-b border-border last:border-0">
              <td className="px-4 py-2.5 whitespace-nowrap">{row.swimmers}</td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                {usd(row.perHour)}
              </td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                {usd(row.perPerson)}
              </td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                {usd(tenHourPrice(row.perHour))}
              </td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                {usd(twentyHourPrice(row.perHour))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "Where are lessons held?",
    answer: (
      <p className={txt}>
        At your home or community pool anywhere in the Irvine area. I come to you. No pool? Ask and
        I&rsquo;ll suggest a nearby option.
      </p>
    ),
  },
  {
    question: "What days and times do you teach?",
    answer: (
      <p className={txt}>
        Tuesday through Friday, 4:00 pm to 8:00 pm. Open times are always live on the{" "}
        <a
          href={siteLinks.booking ?? "/signup"}
          target="_blank"
          rel="noopener noreferrer"
          className="text-link hover:text-link-hover transition-colors duration-150"
        >
          booking page
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        .
      </p>
    ),
  },
  {
    question: "How long is a lesson, and what does it cost?",
    answer: (
      <p className={txt}>
        Book 30, 45 or 60 minutes. Lessons are {usd(PRIVATE_HOURLY_RATE)}/hour, billed by the
        minute: {usd(LESSON_30_MIN)} for 30 minutes, {usd(LESSON_45_MIN)} for 45. Prepaid packages
        save 10% (10 hours, {usd(PACKAGE_10H)}) or 20% (20 hours, {usd(PACKAGE_20H)}), and the
        hours never expire.
      </p>
    ),
  },
  {
    question: "Do you teach group lessons?",
    answer: (
      <>
        <p className={txt}>
          Family lessons only: brothers and sisters from the same household, sharing one booking and
          one balance. I don&rsquo;t mix swimmers from different families in one lesson.
        </p>
        <PricingTable />
        <p className={`${txt} mt-3`}>
          Want a friend to join? Book them their own private lesson right before or after yours.
        </p>
      </>
    ),
  },
  {
    question: "What ages and levels do you teach?",
    answer: (
      <p className={txt}>
        First-timers through competitive club and league swimmers. Little ones (3 and under) do best
        in short 20-minute bursts. Every swimmer is rated skill by skill, 1–5, so you see exactly
        what they&rsquo;ve mastered and what&rsquo;s next.
      </p>
    ),
  },
  {
    question: "What's your cancellation policy?",
    answer: (
      <p className={txt}>
        It runs on the honor system. Life happens, and I won&rsquo;t penalize a family for an
        emergency or illness they couldn&rsquo;t avoid. All I ask is as much notice as you can give,
        so the slot can go to another swimmer.
      </p>
    ),
  },
  {
    question: "What does my swimmer need to bring?",
    answer: (
      <p className={txt}>
        Required: a training swimsuit, goggles, a kickboard, fins and a towel. A swim cap is required
        if hair is long enough to cover the eyes or mouth while swimming. Recommended: a pull buoy.
      </p>
    ),
  },
  {
    question: "What counts as a training swimsuit?",
    answer: (
      <>
        <ul className={`${txt} list-disc list-outside ml-4 flex flex-col gap-1`}>
          <li>Boys: jammers or briefs, no board shorts.</li>
          <li>Girls: a competitive one or two-piece, no fashion suits.</li>
        </ul>
        <p className={`${txt} mt-3`}>
          Loose suits create drag and hide the body position I&rsquo;m correcting.
        </p>
      </>
    ),
  },
  {
    question: "How do I pay?",
    answer: (
      <p className={txt}>
        Cash, Zelle, check or{" "}
        <a
          href={siteLinks.venmo.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-link hover:text-link-hover transition-colors duration-150"
        >
          Venmo ({siteLinks.venmo.handle})
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        .
      </p>
    ),
  },
];
