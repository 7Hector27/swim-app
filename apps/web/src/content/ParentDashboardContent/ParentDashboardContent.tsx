import { calculateAge, todayLA, type MeResponse } from "@swim-app/shared";
import Link from "next/link";

import Placeholder from "@/components/Placeholder";
import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";
import { siteLinks } from "@/lib/siteLinks";
import { fetchSwimmers } from "@/lib/api/swimmers";
import { removeSwimmer } from "./actions";
import SwimmerCard from "./SwimmerCard";

interface Props {
  profile: MeResponse;
  accessToken: string;
}

export default async function ParentDashboardContent({ profile, accessToken }: Props) {
  const firstName = profile.fullName?.trim().split(/\s+/)[0] ?? "there";
  const hasPhone = !!(profile.phone && profile.phone.length > 0);
  const swimmers = await fetchSwimmers(accessToken);
  const today = todayLA();
  const showFinishSetup = !hasPhone;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <SiteNav />

      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-20 tablet:pt-14 tablet:pb-32">
          {/* Page header */}
          <div className="flex flex-col gap-4 mb-8 tablet:flex-row tablet:items-start tablet:justify-between">
            <div>
              <h1 className="text-3xl tablet:text-4xl text-heading">Hi, {firstName}.</h1>
              <p className="mt-2 text-sm text-text-secondary">
                <Placeholder>
                  <span>Your next lesson is [Day] at [0:00 AM].</span>
                </Placeholder>
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
              <Link
                href="/dashboard/swimmers/new"
                className="inline-flex items-center justify-center rounded-button border-2 border-button-outline text-button-outline font-bold text-sm px-5 h-11 transition-colors duration-150 hover:opacity-80"
              >
                Add a swimmer
              </Link>
              <a
                href={siteLinks.booking}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-5 h-11 transition-opacity hover:opacity-90"
              >
                Book a lesson
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
          </div>

          {/* Two-column layout */}
          <div className="flex flex-col tablet:flex-row gap-6 desktop:gap-8 items-start">
            {/* Main column */}
            <div className="flex-1 min-w-0 flex flex-col gap-6">
              <Placeholder block>
                <UpcomingLessonsCard />
              </Placeholder>

              <SwimmersSection
                swimmers={swimmers}
                today={today}
              />
            </div>

            {/* Sidebar */}
            <div className="w-full tablet:w-[272px] desktop:w-[300px] flex-shrink-0 flex flex-col gap-4">
              <Placeholder block>
                <SharedStatsCard />
              </Placeholder>

              {showFinishSetup && <FinishSetupCard hasPhone={hasPhone} />}

              <AccountCard />
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function UpcomingLessonsCard() {
  return (
    <div className="rounded-card border border-border p-5 tablet:p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl text-heading">Upcoming lessons</h2>
        <a
          href="#"
          className="text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
        >
          View schedule
        </a>
      </div>

      <div className="divide-y divide-border">
        <LessonRow
          dayLabel="[SAT]"
          dateLabel="[18]"
          title="[Swimmer], private lesson"
          time="[9:00 to 9:30 AM] at [Location]"
          status="confirmed"
        />
        <LessonRow
          dayLabel="[TUE]"
          dateLabel="[21]"
          title="[Swimmer], private lesson"
          time="[4:30 to 5:15 PM] at [Location]"
          status="pending"
        />
      </div>
    </div>
  );
}

function LessonRow({
  dayLabel,
  dateLabel,
  title,
  time,
  status,
}: {
  dayLabel: string;
  dateLabel: string;
  title: string;
  time: string;
  status: "confirmed" | "pending";
}) {
  return (
    <div className="flex items-center gap-4 py-4">
      <div className="text-center w-9 flex-shrink-0">
        <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wide">
          {dayLabel}
        </p>
        <p className="text-xl font-heading text-heading leading-tight">{dateLabel}</p>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text">{title}</p>
        <p className="text-xs text-text-secondary mt-0.5">{time}</p>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        {status === "confirmed" ? (
          <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-success/10 text-success">
            Confirmed
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-surface-soft text-text-secondary border border-border">
            Pending
          </span>
        )}
        <button
          type="button"
          className="text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
        >
          Change
        </button>
      </div>
    </div>
  );
}

interface SwimmersSectionProps {
  swimmers: Awaited<ReturnType<typeof fetchSwimmers>>;
  today: string;
}

function SwimmersSection({ swimmers, today }: SwimmersSectionProps) {
  return (
    <div>
      <h2 className="text-xl text-heading mb-4">Your swimmers</h2>
      <div className="grid grid-cols-1 tablet:grid-cols-2 gap-4">
        {swimmers.map((swimmer) => {
          const age = calculateAge(swimmer.birthDate, today);
          const boundRemove = removeSwimmer.bind(null, swimmer.id);

          return (
            <SwimmerCard
              key={swimmer.id}
              id={swimmer.id}
              firstName={swimmer.firstName}
              lastName={swimmer.lastName}
              age={age}
              isPublic={swimmer.isPublic}
              removeAction={boundRemove}
            />
          );
        })}
        <AddSwimmerCard />
      </div>
    </div>
  );
}

function AddSwimmerCard() {
  return (
    <Link
      href="/dashboard/swimmers/new"
      className="flex flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-border text-text-secondary min-h-[220px] transition-colors duration-200 hover:border-accent hover:text-accent"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M10 3v14M3 10h14"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-sm font-semibold">Add a swimmer</span>
    </Link>
  );
}

function SharedStatsCard() {
  return (
    <div className="rounded-card border border-border p-5">
      <h3 className="text-base text-heading mb-4">Shared stats access</h3>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text">[Device Name]</p>
          <p className="text-xs text-text-secondary mt-0.5">Last opened [Date]</p>
        </div>
        <button
          type="button"
          className="flex-shrink-0 rounded-button border border-danger text-danger text-xs font-semibold px-3 h-8"
        >
          Revoke
        </button>
      </div>
      <p className="text-xs text-text-secondary mt-4">
        Devices you share stats with. View only.
      </p>
    </div>
  );
}

function FinishSetupCard({ hasPhone }: { hasPhone: boolean }) {
  return (
    <div className="rounded-card border border-border p-5">
      <h3 className="text-base text-heading mb-3">Finish setup</h3>
      {!hasPhone && (
        <div className="flex flex-col gap-1">
          <Link
            href="/account"
            className="text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
          >
            Add a phone number
          </Link>
          <p className="text-xs text-text-secondary">
            So Jason can reach you on lesson day.
          </p>
        </div>
      )}
    </div>
  );
}

function AccountCard() {
  return (
    <div className="rounded-card border border-border p-5">
      <h3 className="text-base text-heading mb-3">Account</h3>
      <div className="flex flex-col gap-2.5">
        <Link
          href="/account"
          className="text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
        >
          Profile and contact info
        </Link>
        <Link
          href="/privacy"
          className="text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
        >
          Privacy and data requests
        </Link>
      </div>
    </div>
  );
}
