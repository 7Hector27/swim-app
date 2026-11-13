import Link from "next/link";

import {
  calculateAge,
  todayLA,
  type BalanceResponse,
  type Club,
  type MeResponse,
  type ParentSwimmer,
  type ParentSwimmerSummary,
} from "@swim-app/shared";

import { fetchBalance } from "@/lib/api/balance";
import { fetchClubs } from "@/lib/api/clubs";
import { fetchHousehold } from "@/lib/api/households";
import { fetchLesson, fetchUpcomingLessons } from "@/lib/api/lessons";
import { fetchParentSwimmerSummaries } from "@/lib/api/parentProgress";
import { fetchSwimmers } from "@/lib/api/swimmers";
import InlineError from "@/components/InlineError";
import { formatApproxHours } from "@/content/AccountBalanceContent/formatters";
import { formatDollars } from "@/lib/formatDollars";
import { removeSwimmer } from "./actions";
import BookingConfirmDialog from "./BookingConfirmDialog";
import {
  bookingDialogStateFor,
  formatLessonDayTime,
  formatRelativeDay,
  swimmerClubName,
} from "./helpers";
import SwimmerCard from "./SwimmerCard";
import UpcomingLessonsCard from "./UpcomingLessonsCard";

interface Props {
  profile: MeResponse;
  accessToken: string;
  bookedLessonId?: string;
  rescheduledLessonId?: string;
  rescheduledFrom?: string;
}

export default async function ParentDashboardContent({ profile, accessToken, bookedLessonId, rescheduledLessonId, rescheduledFrom }: Props) {
  const firstName = profile.fullName?.trim().split(/\s+/)[0] ?? "there";
  const hasPhone = !!(profile.phone && profile.phone.length > 0);
  const [swimmersResult, upcomingLessonsResult, householdResult, bookedLessonResult, rescheduledLessonResult, clubsResult, summariesResult, balanceResult] =
    await Promise.all([
      fetchSwimmers(accessToken),
      fetchUpcomingLessons(accessToken, { limit: 3 }),
      fetchHousehold(accessToken),
      bookedLessonId ? fetchLesson(accessToken, bookedLessonId) : Promise.resolve(null),
      rescheduledLessonId ? fetchLesson(accessToken, rescheduledLessonId) : Promise.resolve(null),
      fetchClubs(accessToken),
      fetchParentSwimmerSummaries(accessToken),
      // ADR 036 Phase 8 Part B Stop 3 piece 4: balance tile for owners
      // and managers (hidden below for viewers). Fetched in parallel
      // with the other dashboard reads so the tile doesn't cost a
      // round trip.
      fetchBalance(accessToken),
    ]);
  // Dashboard is a hub — every card is secondary. If one fetch fails, the
  // page keeps rendering and the broken card shows an InlineError so a
  // roster outage doesn't wipe out the upcoming-lessons card too.
  const swimmers = swimmersResult.ok ? swimmersResult.data : [];
  const swimmersFailed = !swimmersResult.ok;
  const upcomingLessons = upcomingLessonsResult.ok ? upcomingLessonsResult.data.items : [];
  const upcomingCount = upcomingLessonsResult.ok ? upcomingLessonsResult.data.total : null;
  const upcomingFailed = !upcomingLessonsResult.ok;
  // Clubs power the club-name display on swimmer cards. Fall back to empty
  // on error; the swimmer card falls back to "Couldn't load club" through
  // the SwimmerProfileContent helper chain.
  const clubs = clubsResult.ok ? clubsResult.data : [];
  // 5xx / network → generic dialog (confirm the booking without details so
  // the parent doesn't re-submit); 4xx (stale link, not theirs) → no dialog
  // at all; ok → full detail dialog.
  const bookedDialogState = bookingDialogStateFor(bookedLessonId !== undefined, bookedLessonResult);
  const rescheduledDialogState = bookingDialogStateFor(
    rescheduledLessonId !== undefined,
    rescheduledLessonResult,
  );
  const today = todayLA();
  const now = new Date();
  const showFinishSetup = !hasPhone;
  const headerNextLesson = upcomingLessons[0];
  // Household drives the viewer flag that gates the Book button. We can't
  // claim the parent is an owner/manager unless we actually read that back
  // from the server — on load failure (and on the no-household branch)
  // default to viewer mode so we hide actions we can't verify permission
  // for. The API enforces the same rule server-side via
  // requireHouseholdRole("manager"), so this is defense in depth: fail-safe
  // in the client, hard-reject on the server.
  const isViewer = !(
    householdResult.ok &&
    householdResult.household !== null &&
    (householdResult.household.myRole === "owner" ||
      householdResult.household.myRole === "manager")
  );

  const summariesBySwimmer = new Map<string, ParentSwimmerSummary>();
  if (summariesResult.ok) {
    for (const summary of summariesResult.data.summaries) {
      summariesBySwimmer.set(summary.swimmerId, summary);
    }
  }

  return (
    <div className="flex flex-col flex-1 bg-background">

      {bookedDialogState.kind !== "none" && (
        <BookingConfirmDialog
          {...(bookedDialogState.kind === "detail" && { lesson: bookedDialogState.lesson })}
        />
      )}
      {rescheduledDialogState.kind !== "none" && (
        <BookingConfirmDialog
          {...(rescheduledDialogState.kind === "detail" && {
            lesson: rescheduledDialogState.lesson,
          })}
          {...(rescheduledFrom !== undefined && { movedFrom: rescheduledFrom })}
        />
      )}

      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-tab-safe tablet:pt-14 tablet:pb-32">
          {/* Page header */}
          <div className="flex flex-col gap-4 mb-8 tablet:flex-row tablet:items-start tablet:justify-between">
            <div>
              <h1 className="text-3xl tablet:text-4xl text-heading">Hi, {firstName}.</h1>
              <p className="mt-2 text-sm text-text-secondary">
                {headerNextLesson
                  ? `Your next lesson is ${formatLessonDayTime(headerNextLesson.startsAt, { weekday: "long" })}.`
                  : "No lessons booked yet."}
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
              <Link
                href="/dashboard/swimmers/new"
                className="inline-flex items-center justify-center rounded-button border-2 border-button-outline text-button-outline font-bold text-sm px-5 h-11 transition-colors duration-150 hover:opacity-80"
              >
                Add a swimmer
              </Link>
              {isViewer ? (
                <span
                  aria-disabled="true"
                  title="Ask the household owner to book."
                  className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-5 h-11 opacity-50 cursor-not-allowed select-none"
                >
                  Book a lesson
                </span>
              ) : (
                <Link
                  href="/dashboard/book"
                  className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-5 h-11 transition-opacity hover:opacity-90"
                >
                  Book a lesson
                </Link>
              )}
            </div>
          </div>

          {/* ADR 036 Phase 8 Part B Stop 3 piece 9: on mobile the
              balance tile floats above the two-column layout so the
              parent sees the dollar balance without scrolling past
              swimmers and upcoming lessons first. On tablet+ the
              tile lives in the sidebar at its original position, so
              the main column (Upcoming + Swimmers) keeps the hero
              slot the desktop layout was designed around. */}
          {!isViewer && balanceResult !== null && (
            <div className="tablet:hidden mb-6">
              <BalanceCard balance={balanceResult} />
            </div>
          )}

          {/* Two-column layout */}
          <div className="flex flex-col tablet:flex-row tablet:items-start gap-6 desktop:gap-8">
            {/* Main column: full width on phone, flex-1 on tablet+ */}
            <div className="w-full min-w-0 flex flex-col gap-6 tablet:flex-1">
              {upcomingFailed ? (
                <InlineError message="Couldn't load upcoming lessons." reloadOnRetry />
              ) : (
                <UpcomingLessonsCard lessons={upcomingLessons} total={upcomingCount ?? upcomingLessons.length} />
              )}

              {swimmersFailed ? (
                <section>
                  <h2 className="text-xl text-heading mb-4">Your swimmers</h2>
                  <InlineError message="Couldn't load your swimmers." reloadOnRetry />
                </section>
              ) : (
                <SwimmersSection
                  swimmers={swimmers}
                  today={today}
                  now={now}
                  clubs={clubs}
                  summariesBySwimmer={summariesBySwimmer}
                />
              )}
            </div>

            {/* Sidebar */}
            <div className="w-full tablet:w-[272px] desktop:w-[300px] flex-shrink-0 flex flex-col gap-4">
              {showFinishSetup && <FinishSetupCard hasPhone={hasPhone} />}

              {/* Tablet+ placement: the balance tile sits in the sidebar
                  next to the rest of the account controls. Hidden below
                  the tablet breakpoint — the mobile render above owns
                  the tile there. */}
              {!isViewer && balanceResult !== null && (
                <div className="hidden tablet:block">
                  <BalanceCard balance={balanceResult} />
                </div>
              )}

              <AccountCard />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface SwimmersSectionProps {
  swimmers: ParentSwimmer[];
  today: string;
  now: Date;
  clubs: Club[];
  summariesBySwimmer: Map<string, ParentSwimmerSummary>;
}

function SwimmersSection({
  swimmers,
  today,
  now,
  clubs,
  summariesBySwimmer,
}: SwimmersSectionProps) {
  return (
    <div>
      <h2 className="text-xl text-heading mb-4">Your swimmers</h2>
      <div className="grid grid-cols-1 tablet:grid-cols-2 gap-4">
        {swimmers.map((swimmer) => {
          const age = calculateAge(swimmer.birthDate, today);
          const boundRemove = removeSwimmer.bind(null, swimmer.id);
          const summary = summariesBySwimmer.get(swimmer.id);

          return (
            <SwimmerCard
              key={swimmer.id}
              id={swimmer.id}
              firstName={swimmer.firstName}
              lastName={swimmer.lastName}
              age={age}
              clubName={swimmerClubName(swimmer, clubs)}
              nextLessonLine={
                summary?.nextLesson
                  ? formatLessonDayTime(summary.nextLesson.startsAt, { weekday: "short" })
                  : null
              }
              lastEvaluatedLabel={
                summary?.lastEvaluatedOn ? formatRelativeDay(summary.lastEvaluatedOn, now) : null
              }
              bestEvent={summary?.bestEvent ?? null}
              onLeaderboards={summary?.onLeaderboards ?? false}
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

interface BalanceCardProps {
  balance: BalanceResponse;
}

function BalanceCard({ balance }: BalanceCardProps) {
  return (
    <div
      data-testid="dashboard-balance-tile"
      className="rounded-card border border-border p-5"
    >
      <h3 className="text-base text-heading mb-3">Balance</h3>
      <p
        data-testid="dashboard-balance-dollars"
        className="text-2xl font-bold text-heading"
      >
        {formatDollars(balance.balanceCents)}
      </p>
      <p
        data-testid="dashboard-balance-hours"
        className="text-sm text-text-secondary mt-1"
      >
        {formatApproxHours(balance.approximatePrivateHours)} of private lessons
      </p>
      <Link
        href="/account/balance"
        className="mt-3 inline-block text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
      >
        Add funds and see history
      </Link>
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
          href="/household"
          className="text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
        >
          Household settings
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
