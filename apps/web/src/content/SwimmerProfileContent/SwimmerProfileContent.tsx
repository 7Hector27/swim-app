import Link from "next/link";

import type {
  Club,
  HouseholdRole,
  ParentPersonalBestsResponse,
  ParentSwimmer,
  ParentSwimmerProgressResponse,
  ParentScoreHistoryResponse,
  UpcomingLesson,
} from "@swim-app/shared";

import PublicToggleSection from "@/components/PublicToggleSection";

import LessonsSection from "./LessonsSection";
import NextLessonSection from "./NextLessonSection";
import PersonalBestsSection from "./PersonalBestsSection";
import ProfileHeader from "./ProfileHeader";
import ProgressSnapshotSection from "./ProgressSnapshotSection";
import styles from "./SwimmerProfileContent.module.css";
import {
  filterLessonsForSwimmer,
  parentSwimmerAge,
  swimmerClubName,
} from "./helpers";

// Local alias with no `reason` field — the sections only need to know
// ok/not-ok. Server-page code builds this from a LoadResult-shaped value by
// dropping the reason at the prop boundary.
export type SectionResult<T> = { ok: true; data: T } | { ok: false };

interface SwimmerProfileContentProps {
  swimmer: ParentSwimmer;
  householdRole: HouseholdRole;
  // Clubs is a SectionResult so the profile can distinguish a failed load
  // ("Couldn't load club") from an actually-empty catalog. The page can
  // still render — this is a secondary display field.
  clubsResult: SectionResult<Club[]>;
  progress: SectionResult<ParentSwimmerProgressResponse>;
  // Latest category rollups power the small radar on the Progress card.
  // Comes from GET /swimmers/:id/score-history on the server, with the parent
  // route's visibility rules already applied.
  scoreHistory: SectionResult<ParentScoreHistoryResponse>;
  personalBests: SectionResult<ParentPersonalBestsResponse>;
  upcomingLessons: SectionResult<UpcomingLesson[]>;
  pastLessons: SectionResult<UpcomingLesson[]>;
}

export default function SwimmerProfileContent({
  swimmer,
  householdRole,
  clubsResult,
  progress,
  scoreHistory,
  personalBests,
  upcomingLessons,
  pastLessons,
}: SwimmerProfileContentProps) {
  const age = parentSwimmerAge(swimmer.birthDate);
  // Distinguish three states for the club field:
  //  - ok + resolves to a name: show the name.
  //  - ok + no name: show nothing (the ProfileHeader handles this).
  //  - fetch failed: show a short "Couldn't load club" placeholder so the
  //    coach/parent doesn't read a blank space as "no club set."
  const clubName = clubsResult.ok
    ? swimmerClubName(swimmer, clubsResult.data)
    : "Couldn't load club";
  const canEdit = householdRole === "owner" || householdRole === "manager";
  const canBook = canEdit;

  const upcomingForSwimmer = upcomingLessons.ok
    ? filterLessonsForSwimmer(upcomingLessons.data, swimmer.id)
    : [];
  const pastForSwimmer = pastLessons.ok
    ? filterLessonsForSwimmer(pastLessons.data, swimmer.id)
    : [];
  const nextLesson = upcomingForSwimmer[0] ?? null;

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
              Main group. On phone (<769) this is `display: contents` so its
              children stack directly in the outer flex, in the per-child
              order values. At tablet and up it becomes a real flex column in
              the main grid area: NextLesson, Lessons, PBs.
            */}
            <div className={styles.mainGroup}>
              <div className={styles.next}>
                <NextLessonSection
                  lesson={nextLesson}
                  upcomingFailed={!upcomingLessons.ok}
                  canBook={canBook}
                />
              </div>

              <div className={styles.lessons}>
                <LessonsSection
                  upcoming={upcomingLessons}
                  past={pastLessons}
                  upcomingForSwimmer={upcomingForSwimmer}
                  pastForSwimmer={pastForSwimmer}
                />
              </div>

              <div className={styles.pbs}>
                <PersonalBestsSection result={personalBests} />
              </div>
            </div>

            {/*
              Sidebar group. Same display: contents pattern on phone. At
              tablet and up it's the right-hand column holding the Progress
              card followed by the public leaderboards setting (sticky at
              desktop).
            */}
            <div className={styles.sidebarGroup}>
              <div className={styles.focus}>
                <ProgressSnapshotSection
                  result={progress}
                  scoreHistory={scoreHistory}
                  swimmerId={swimmer.id}
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
