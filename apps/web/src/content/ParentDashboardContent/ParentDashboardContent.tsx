import Link from "next/link";

import {
  calculateAge,
  todayLA,
  type MeResponse,
  type ParentPersonalBest,
  type ParentSwimmerProgressResponse,
} from "@swim-app/shared";

import { fetchClubs } from "@/lib/api/clubs";
import { fetchHousehold } from "@/lib/api/households";
import { fetchLesson, fetchUpcomingLessons } from "@/lib/api/lessons";
import {
  fetchParentPersonalBests,
  fetchParentSwimmerProgress,
} from "@/lib/api/parentProgress";
import { fetchSwimmers } from "@/lib/api/swimmers";
import { removeSwimmer } from "./actions";
import BookingConfirmDialog from "./BookingConfirmDialog";
import {
  formatNextLessonLine,
  formatRelativeDay,
  latestEvaluationDate,
  nextLessonForSwimmer,
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
  const [swimmers, upcomingLessonsRaw, household, bookedLesson, rescheduledLesson, clubs] =
    await Promise.all([
      fetchSwimmers(accessToken),
      fetchUpcomingLessons(accessToken, { limit: 50 }),
      fetchHousehold(accessToken),
      bookedLessonId ? fetchLesson(accessToken, bookedLessonId) : Promise.resolve(null),
      rescheduledLessonId ? fetchLesson(accessToken, rescheduledLessonId) : Promise.resolve(null),
      fetchClubs(accessToken),
    ]);
  const upcomingLessons = upcomingLessonsRaw?.items ?? [];
  const upcomingCount = upcomingLessonsRaw?.total ?? null;
  const today = todayLA();
  const now = new Date();
  const showFinishSetup = !hasPhone;
  const nextLesson = upcomingLessons[0];
  const householdRole = household?.myRole ?? null;
  const isViewer = householdRole === "viewer";

  const [progressResults, pbResults] = await Promise.all([
    Promise.all(swimmers.map((swimmer) => fetchParentSwimmerProgress(swimmer.id, accessToken))),
    Promise.all(swimmers.map((swimmer) => fetchParentPersonalBests(swimmer.id, accessToken))),
  ]);

  const progressBySwimmer = new Map<string, ParentSwimmerProgressResponse | null>();
  const personalBestsBySwimmer = new Map<string, ParentPersonalBest[]>();
  swimmers.forEach((swimmer, index) => {
    const progressResult = progressResults[index];
    progressBySwimmer.set(
      swimmer.id,
      progressResult && progressResult.ok ? progressResult.data : null,
    );
    const pbResult = pbResults[index];
    personalBestsBySwimmer.set(
      swimmer.id,
      pbResult && pbResult.ok ? pbResult.data.personalBests : [],
    );
  });

  return (
    <div className="flex flex-col flex-1 bg-background">

      {bookedLesson && <BookingConfirmDialog lesson={bookedLesson} />}
      {rescheduledLesson && <BookingConfirmDialog lesson={rescheduledLesson} {...(rescheduledFrom !== undefined && { movedFrom: rescheduledFrom })} />}

      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-tab-safe tablet:pt-14 tablet:pb-32">
          {/* Page header */}
          <div className="flex flex-col gap-4 mb-8 tablet:flex-row tablet:items-start tablet:justify-between">
            <div>
              <h1 className="text-3xl tablet:text-4xl text-heading">Hi, {firstName}.</h1>
              <p className="mt-2 text-sm text-text-secondary">
                {nextLesson
                  ? `Your next lesson is ${formatNextLessonLabel(nextLesson.startsAt)}.`
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

          {/* Two-column layout */}
          <div className="flex flex-col tablet:flex-row tablet:items-start gap-6 desktop:gap-8">
            {/* Main column: full width on phone, flex-1 on tablet+ */}
            <div className="w-full min-w-0 flex flex-col gap-6 tablet:flex-1">
              <UpcomingLessonsCard lessons={upcomingLessons} total={upcomingCount ?? upcomingLessons.length} />

              <SwimmersSection
                swimmers={swimmers}
                today={today}
                now={now}
                clubs={clubs}
                upcomingLessons={upcomingLessons}
                progressBySwimmer={progressBySwimmer}
                personalBestsBySwimmer={personalBestsBySwimmer}
              />
            </div>

            {/* Sidebar */}
            <div className="w-full tablet:w-[272px] desktop:w-[300px] flex-shrink-0 flex flex-col gap-4">
              {showFinishSetup && <FinishSetupCard hasPhone={hasPhone} />}

              <AccountCard />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ── Helper ────────────────────────────────────────────────────────────────────

function formatNextLessonLabel(startsAt: string): string {
  const date = new Date(startsAt);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${day} at ${time}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface SwimmersSectionProps {
  swimmers: Awaited<ReturnType<typeof fetchSwimmers>>;
  today: string;
  now: Date;
  clubs: Awaited<ReturnType<typeof fetchClubs>>;
  upcomingLessons: Awaited<ReturnType<typeof fetchUpcomingLessons>> extends infer T
    ? T extends { items: infer Items }
      ? Items
      : never
    : never;
  progressBySwimmer: Map<string, ParentSwimmerProgressResponse | null>;
  personalBestsBySwimmer: Map<string, ParentPersonalBest[]>;
}

function SwimmersSection({
  swimmers,
  today,
  now,
  clubs,
  upcomingLessons,
  progressBySwimmer,
  personalBestsBySwimmer,
}: SwimmersSectionProps) {
  return (
    <div>
      <h2 className="text-xl text-heading mb-4">Your swimmers</h2>
      <div className="grid grid-cols-1 tablet:grid-cols-2 gap-4">
        {swimmers.map((swimmer) => {
          const age = calculateAge(swimmer.birthDate, today);
          const boundRemove = removeSwimmer.bind(null, swimmer.id);
          const nextLesson = nextLessonForSwimmer(upcomingLessons, swimmer.id);
          const progress = progressBySwimmer.get(swimmer.id) ?? null;
          const evalDate = latestEvaluationDate(progress);
          const personalBests = personalBestsBySwimmer.get(swimmer.id) ?? [];
          const onLeaderboards = swimmer.isPublic && personalBests.length > 0;

          return (
            <SwimmerCard
              key={swimmer.id}
              id={swimmer.id}
              firstName={swimmer.firstName}
              lastName={swimmer.lastName}
              age={age}
              clubName={swimmerClubName(swimmer, clubs)}
              nextLessonLine={nextLesson ? formatNextLessonLine(nextLesson) : null}
              lastEvaluatedLabel={evalDate ? formatRelativeDay(evalDate, now) : null}
              onLeaderboards={onLeaderboards}
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
