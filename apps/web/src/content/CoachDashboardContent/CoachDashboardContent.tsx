import type { MeResponse, CoachSwimmer } from "@swim-app/shared";

import Placeholder from "@/components/Placeholder";
import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";
import { fetchCoachSwimmers } from "@/lib/api/coachSwimmers";
import SwimmersTable from "./SwimmersTable";

interface Props {
  profile: MeResponse;
  accessToken: string;
}

export default async function CoachDashboardContent({ accessToken }: Props) {
  const swimmers = await fetchCoachSwimmers(accessToken);

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date());

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <SiteNav />

      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-20 tablet:pt-14 tablet:pb-32">
          {/* Page header */}
          <div className="flex flex-col gap-4 mb-8 tablet:flex-row tablet:items-start tablet:justify-between">
            <div>
              <h1 className="text-3xl tablet:text-4xl text-heading">{dateLabel}</h1>
              <p className="mt-2 text-sm text-text-secondary">
                <Placeholder>
                  <span>[#] lessons today, [#] at [Location].</span>
                </Placeholder>
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
              <Placeholder>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-button border-2 border-button-outline text-button-outline font-bold text-sm px-5 h-11 transition-colors duration-150 hover:opacity-80"
                >
                  Log a time
                </button>
              </Placeholder>
              <Placeholder>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-button border-2 border-button-outline text-button-outline font-bold text-sm px-5 h-11 transition-colors duration-150 hover:opacity-80"
                >
                  Edit availability
                </button>
              </Placeholder>
              <Placeholder>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-5 h-11 transition-opacity hover:opacity-90"
                >
                  Add swimmer
                </button>
              </Placeholder>
            </div>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 tablet:grid-cols-4 gap-4 mb-8">
            <Placeholder block>
              <StatCard label="Lessons today" value="[#]" />
            </Placeholder>
            <Placeholder block>
              <StatCard label="Requests to review" value="[#]" accent />
            </Placeholder>
            <StatCard label="Active swimmers" value={String(swimmers.length)} />
            <Placeholder block>
              <StatCard label="Lessons this week" value="[#]" />
            </Placeholder>
          </div>

          {/* Two-column layout */}
          <div className="flex flex-col tablet:flex-row gap-6 desktop:gap-8 items-start">
            {/* Main column */}
            <div className="flex-1 min-w-0 flex flex-col gap-6">
              <Placeholder block>
                <TodayScheduleCard />
              </Placeholder>

              <SwimmersSection swimmers={swimmers} />
            </div>

            {/* Sidebar */}
            <div className="w-full tablet:w-[272px] desktop:w-[300px] flex-shrink-0 flex flex-col gap-4">
              <Placeholder block>
                <BookingRequestsCard />
              </Placeholder>
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

function TodayScheduleCard() {
  return (
    <div className="rounded-card border border-border p-5 tablet:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl text-heading">Today&apos;s schedule</h2>
        <a
          href="#"
          className="text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
        >
          Full calendar
        </a>
      </div>

      <div className="divide-y divide-border">
        <ScheduleRow
          time="[1:30 PM]"
          title="[Swimmer], 30 min"
          detail="Private lesson"
        />
        <ScheduleRow
          time="[2:30 PM]"
          title="[Swimmer], 30 min"
          detail="Open, back to back"
        />
        <TravelBufferRow time="[4:00 PM]" duration="[30 min]" />
        <ScheduleRow
          time="[5:15 PM]"
          title="[Swimmer], 45 min"
          detail="Open until [6:30 PM]"
        />
        <OpenSlotRow time="[6:30 PM]" until="[7:30 PM]" />
      </div>
    </div>
  );
}

function ScheduleRow({
  time,
  title,
  detail,
}: {
  time: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-4 py-4">
      <div className="flex-shrink-0 w-[68px]">
        <p className="text-xs font-semibold text-text-secondary tabular-nums">{time}</p>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text">{title}</p>
        <p className="text-xs text-text-secondary mt-0.5">{detail}</p>
      </div>
      <button
        type="button"
        className="flex-shrink-0 text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150 min-h-[44px] flex items-center"
      >
        Open swimmer
      </button>
    </div>
  );
}

function TravelBufferRow({ time, duration }: { time: string; duration: string }) {
  return (
    <div className="flex items-center gap-4 py-4">
      <div className="flex-shrink-0 w-[68px]">
        <p className="text-xs font-semibold text-text-secondary tabular-nums">{time}</p>
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="flex-shrink-0 text-text-secondary"
          aria-hidden="true"
        >
          <rect x="1" y="3" width="15" height="13" rx="2" />
          <path d="M16 8h4l3 3v5h-7V8z" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-text">
            Travel buffer, {duration}
          </p>
          <p className="text-xs text-text-secondary mt-0.5">
            Blocked automatically. Not bookable.
          </p>
        </div>
      </div>
    </div>
  );
}

function OpenSlotRow({ time, until }: { time: string; until: string }) {
  return (
    <div className="flex items-center gap-4 py-4">
      <div className="flex-shrink-0 w-[68px]">
        <p className="text-xs font-semibold text-text-secondary tabular-nums">{time}</p>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-secondary">
          Open until {until}
        </p>
      </div>
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

function BookingRequestsCard() {
  return (
    <div className="rounded-card border border-border p-5">
      <h3 className="text-base text-heading mb-4">Booking requests</h3>
      <div className="flex flex-col divide-y divide-border">
        <BookingRequestRow
          name="[Swimmer], 30 min"
          time="[Thu, Oct 23] at [4:30–5:00 PM]"
        />
        <BookingRequestRow
          name="[Swimmer], 30 min"
          time="[Thu, Oct 21] at [3:30–4:30 PM]"
        />
      </div>
    </div>
  );
}

function BookingRequestRow({ name, time }: { name: string; time: string }) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div>
        <p className="text-sm font-semibold text-text">{name}</p>
        <p className="text-xs text-text-secondary mt-0.5">{time}</p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 rounded-button bg-button-primary-background text-button-primary-text font-semibold text-xs h-9 transition-opacity hover:opacity-90 active:scale-[0.97]"
        >
          Approve
        </button>
        <button
          type="button"
          className="flex-1 rounded-button border border-border text-text-secondary font-semibold text-xs h-9 hover:bg-surface-soft transition-colors duration-150"
        >
          Decline
        </button>
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
