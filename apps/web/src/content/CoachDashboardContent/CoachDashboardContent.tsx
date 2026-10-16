import type { CoachSwimmer } from "@swim-app/shared";
import { todayLA } from "@swim-app/shared";

import Placeholder from "@/components/Placeholder";
import SiteFooter from "@/components/SiteFooter";
import { SHOW_PLACEHOLDERS } from "@/config/placeholders";
import { fetchCoachSwimmers } from "@/lib/api/coachSwimmers";
import { coachGetPendingLessons, fetchCoachSchedule, fetchCoachStats } from "@/lib/api/lessons";
import BookingRequestsCard from "./BookingRequestsCard";
import SwimmersTable from "./SwimmersTable";
import TodayScheduleCard from "./TodayScheduleCard";

interface Props {
  accessToken: string;
}

export default async function CoachDashboardContent({ accessToken }: Props) {
  const today = todayLA();
  const [swimmers, pendingLessons, scheduleItems, stats] = await Promise.all([
    fetchCoachSwimmers(accessToken),
    coachGetPendingLessons(accessToken),
    fetchCoachSchedule(accessToken, today),
    fetchCoachStats(accessToken),
  ]);

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date());

  return (
    <div className="flex flex-col min-h-screen bg-background">

      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-20 tablet:pt-14 tablet:pb-32">
          {/* Page header */}
          <div className="flex flex-col gap-4 mb-8">
            <div>
              <h1 className="text-3xl tablet:text-4xl text-heading">{dateLabel}</h1>
              <p className="mt-2 text-sm text-text-secondary">
                {(stats?.lessonsToday ?? 0) === 0
                  ? "No lessons today."
                  : `${stats?.lessonsToday} lesson${(stats?.lessonsToday ?? 0) !== 1 ? "s" : ""} today.`}
              </p>
            </div>

            <div className="flex flex-col gap-3 tablet:flex-row tablet:flex-wrap">
              <a
                href="/coach/meets"
                className="w-full tablet:w-auto inline-flex items-center justify-center rounded-button border-2 border-button-outline text-button-outline font-bold text-sm px-5 h-11 transition-colors duration-150 hover:opacity-80"
              >
                Log a time
              </a>
              {SHOW_PLACEHOLDERS ? (
                <button
                  type="button"
                  inert
                  aria-hidden="true"
                  className="w-full tablet:w-auto inline-flex items-center justify-center gap-2 rounded-button border-2 border-button-outline text-button-outline font-bold text-sm px-5 h-11"
                >
                  Edit availability
                  <span className="rounded-full bg-surface-soft border border-border text-text-secondary text-[10px] font-semibold px-1.5 leading-5 whitespace-nowrap">
                    Coming soon
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  className="w-full tablet:w-auto inline-flex items-center justify-center rounded-button border-2 border-button-outline text-button-outline font-bold text-sm px-5 h-11 transition-colors duration-150 hover:opacity-80"
                >
                  Edit availability
                </button>
              )}
            </div>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 tablet:grid-cols-4 gap-4 mb-8">
            <StatCard label="Lessons today" value={String(stats?.lessonsToday ?? 0)} />
            <StatCard label="Requests to review" value={String(stats?.pendingRequests ?? 0)} accent />
            <StatCard label="Active swimmers" value={String(stats?.activeSwimmers ?? swimmers.length)} />
            <StatCard label="Lessons this week" value={String(stats?.lessonsThisWeek ?? 0)} />
          </div>

          {/* Two-column layout */}
          <div className="flex flex-col tablet:flex-row gap-6 desktop:gap-8 tablet:items-start">
            {/* Main column */}
            <div className="w-full tablet:flex-1 min-w-0 flex flex-col gap-6">
              <TodayScheduleCard items={scheduleItems} />

              <SwimmersSection swimmers={swimmers} />
            </div>

            {/* Sidebar */}
            <div className="w-full tablet:w-[272px] desktop:w-[300px] flex-shrink-0 flex flex-col gap-4">
              <BookingRequestsCard initialLessons={pendingLessons} />
              <Placeholder block>
                <NeedsAttentionCard />
              </Placeholder>
              <Placeholder block>
                <SetupCard />
              </Placeholder>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-card border border-border p-5">
      <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest mb-2">
        {label}
      </p>
      <p className={`text-4xl font-heading ${accent ? "text-accent" : "text-heading"}`}>
        {value}
      </p>
    </div>
  );
}

function SwimmersSection({ swimmers }: { swimmers: CoachSwimmer[] }) {
  return (
    <div className="rounded-card border border-border overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-xl text-heading">Swimmers</h2>
      </div>

      <SwimmersTable swimmers={swimmers} />

      <div className="px-5 py-4 border-t border-border">
        <a
          href="/coach/swimmers"
          className="text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
        >
          View all swimmers
        </a>
      </div>
    </div>
  );
}

function NeedsAttentionCard() {
  const items = [
    {
      label: "Log times from last meet",
      detail: "[#] swimmers have no time since [date].",
    },
    {
      label: "Review draft connections",
      detail: "Possible swimmers not yet linked.",
    },
    {
      label: "Flag a problematic account",
      detail: "[#] new requests pending review.",
    },
  ];

  return (
    <div className="rounded-card border border-border p-5">
      <h3 className="text-base text-heading mb-3">Needs attention</h3>
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <div key={item.label}>
            <a
              href="#"
              className="text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
            >
              {item.label}
            </a>
            <p className="text-xs text-text-secondary mt-0.5">{item.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SetupCard() {
  const items = [
    "Add salary and drive values",
    "Locations and distances from travel",
    "Travel buffer rules",
    "Public profile page",
  ];

  return (
    <div className="rounded-card border border-border p-5">
      <h3 className="text-base text-heading mb-3">Setup</h3>
      <div className="flex flex-col gap-2.5">
        {items.map((item) => (
          <a
            key={item}
            href="#"
            className="text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
          >
            {item}
          </a>
        ))}
      </div>
    </div>
  );
}
