import Link from "next/link";

import type {
  Club,
  HouseholdRole,
  ParentPersonalBestsResponse,
  ParentSwimmer,
  ParentSwimmerProgressResponse,
  UpcomingLesson,
} from "@swim-app/shared";

import PublicToggleSection from "@/components/PublicToggleSection";

import LessonsSection from "./LessonsSection";
import NextLessonSection from "./NextLessonSection";
import PersonalBestsSection from "./PersonalBestsSection";
import ProfileHeader from "./ProfileHeader";
import ProgressSnapshotSection from "./ProgressSnapshotSection";
import StatTiles from "./StatTiles";
import styles from "./SwimmerProfileContent.module.css";
import {
  filterLessonsForSwimmer,
  parentSwimmerAge,
  swimmerClubName,
} from "./helpers";

export type SectionResult<T> = { ok: true; data: T } | { ok: false };

interface SwimmerProfileContentProps {
  swimmer: ParentSwimmer;
  householdRole: HouseholdRole;
  clubs: Club[];
  progress: SectionResult<ParentSwimmerProgressResponse>;
  personalBests: SectionResult<ParentPersonalBestsResponse>;
  upcomingLessons: SectionResult<UpcomingLesson[]>;
  pastLessons: SectionResult<UpcomingLesson[]>;
}

export default function SwimmerProfileContent({
  swimmer,
  householdRole,
  clubs,
  progress,
  personalBests,
  upcomingLessons,
  pastLessons,
}: SwimmerProfileContentProps) {
  const age = parentSwimmerAge(swimmer.birthDate);
  const clubName = swimmerClubName(swimmer, clubs);
  const canEdit = householdRole === "owner" || householdRole === "manager";
  const canBook = canEdit;

  const upcomingForSwimmer = upcomingLessons.ok
    ? filterLessonsForSwimmer(upcomingLessons.data, swimmer.id)
    : [];
  const pastForSwimmer = pastLessons.ok
    ? filterLessonsForSwimmer(pastLessons.data, swimmer.id)
    : [];
  const nextLesson = upcomingForSwimmer[0] ?? null;

  const upcomingCountDisplay = upcomingLessons.ok ? upcomingForSwimmer.length : null;

  // Current focus = most recent non-empty priority from a non-voided session.
  // The API already filters out empty priorities and sessions whose every
  // rating has been voided, so passing it straight through is safe.
  const coachingPriority = progress.ok ? progress.data.latestCoachingPriority : null;
  const lastEvalDate = progress.ok ? progress.data.latestCoachingNotes[0]?.sessionDate ?? null : null;

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-tab-safe tablet:pt-14 tablet:pb-32">
          <div className={styles.layout}>
            <Link
              href="/dashboard"
              className={`inline-flex items-center gap-1 text-sm text-link hover:text-link-hover self-start ${styles.nav}`}
            >
              ← Dashboard
            </Link>

            <div className={styles.hero}>
              <ProfileHeader
                swimmer={swimmer}
                age={age}
                clubName={clubName}
                canEdit={canEdit}
                canBook={canBook}
              />
            </div>

            {/*
              Main group. On mobile and tablet this is `display: contents` so
              its children stack with the rest of the page. On desktop it
              becomes a real flex column in the main grid area.
            */}
            <div className={styles.mainGroup}>
              <div className={styles.next}>
                <NextLessonSection
                  lesson={nextLesson}
                  upcomingFailed={!upcomingLessons.ok}
                  canBook={canBook}
                />
              </div>

              <div className={styles.focus}>
                <ProgressSnapshotSection
                  result={progress}
                  priority={coachingPriority}
                  swimmerId={swimmer.id}
                />
              </div>

              <div className={styles.pbs}>
                <PersonalBestsSection result={personalBests} />
              </div>

              <div className={styles.lessons}>
                <LessonsSection
                  upcoming={upcomingLessons}
                  past={pastLessons}
                  upcomingForSwimmer={upcomingForSwimmer}
                  pastForSwimmer={pastForSwimmer}
                  canBook={canBook}
                />
              </div>
            </div>

            {/*
              Sidebar group. Same display: contents pattern. On desktop it
              becomes the right-hand sticky-adjacent column holding stats
              and the leaderboard toggle.
            */}
            <div className={styles.sidebarGroup}>
              <div className={styles.stats}>
                <StatTiles
                  age={age}
                  lastEvalDate={lastEvalDate}
                  progressFailed={!progress.ok}
                  upcomingCount={upcomingCountDisplay}
                  isPublic={swimmer.isPublic}
                />
              </div>

              <div className={styles.toggle}>
                <PublicToggleSection
                  swimmerId={swimmer.id}
                  isPublic={swimmer.isPublic}
                  householdRole={householdRole}
                  swimmerFirstName={swimmer.firstName}
                />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
