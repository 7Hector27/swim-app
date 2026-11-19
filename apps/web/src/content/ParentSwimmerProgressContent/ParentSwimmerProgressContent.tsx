import type {
  ParentCategoriesResponse,
  ParentScoreHistoryResponse,
  ParentSkillProgress,
  ParentSwimmer,
  ParentSwimmerProgressResponse,
} from "@swim-app/shared";
import InlineError from "@/components/InlineError";
import StartsSection from "@/components/StartsSection";
import CategoryRadar from "@/content/SwimmerProgressContent/charts/CategoryRadar";
import { firstScreenGroupSnapshot, latestScreenGroupSnapshot } from "@/lib/progressCharts";
import { buildCatalogIndex } from "@/lib/screenGroups";
import ParentStrokeGroupsPanel from "./ParentStrokeGroupsPanel";
import CoachFocusList from "./sections/CoachFocusList";
import CoachNoteCard from "./sections/CoachNoteCard";
import GolfScoreList, { type ParentGolfTrend } from "./sections/GolfScoreList";
import RecentWins from "./sections/RecentWins";
import SummaryCard from "./sections/SummaryCard";
import { buildRecentWins, buildSummaryCard } from "./helpers";

// Per-section failure flags. `progress` is primary (the page throws if it
// fails), so it isn't listed. Defaults to all false, keeping existing tests
// that don't pass this prop green.
export interface ParentSwimmerProgressSectionFailures {
  categories?: boolean;
  scoreHistory?: boolean;
}

interface ParentSwimmerProgressContentProps {
  swimmer: ParentSwimmer;
  progress: ParentSwimmerProgressResponse;
  categories: ParentCategoriesResponse;
  scoreHistory?: ParentScoreHistoryResponse;
  sectionFailures?: ParentSwimmerProgressSectionFailures;
}

const EMPTY_SCORE_HISTORY: ParentScoreHistoryResponse = {
  points: [],
  recentChanges: [],
  milestones: [],
  measurements: [],
};

// Phone / tablet share the same DOM subtree (a linear stack); desktop
// uses a separate 12-column CSS-grid block. We render both and let CSS
// switch which is visible at the desktop breakpoint — simpler to reason
// about than cross-breakpoint `order` juggling and keeps the two layouts'
// assertion targets distinct in tests.
//
// Phone order follows the current page's order: Summary → Wins → Note →
// Focus → Snapshot → Starts → Skills → Golf. Tablet matches that order
// but uses internal 2-col / 3-col grids where the brief calls for them
// (Snapshot + Starts side by side; Focus / Wins / Golf as 3-up card rows).
//
// Golf score is wired through the layout even though the parent response
// doesn't currently ship any golf data — the component renders null on an
// empty trends array so the section quietly disappears until a parent
// golf endpoint lands.
export default function ParentSwimmerProgressContent({
  swimmer,
  progress,
  categories,
  scoreHistory = EMPTY_SCORE_HISTORY,
  sectionFailures = {},
}: ParentSwimmerProgressContentProps) {
  const categorySnapshot = latestScreenGroupSnapshot(scoreHistory);
  const firstSnapshot = firstScreenGroupSnapshot(scoreHistory);

  const startComponentSlugs = new Set(
    progress.startProgress.flatMap((start) => start.components.map((component) => component.slug)),
  );
  const displaySkills = progress.skills.filter((skill) => !startComponentSlugs.has(skill.slug));

  const latestScreenGroupRollups =
    scoreHistory.points[scoreHistory.points.length - 1]?.screenGroupRollups ?? [];

  const nowIso = new Date().toISOString();

  const catalogIndex = buildCatalogIndex(categories);
  const skillsBySlug = new Map<string, ParentSkillProgress>();
  for (const skill of progress.skills) skillsBySlug.set(skill.slug, skill);

  const sessionDates = scoreHistory.points.map((point) => point.sessionDate);
  const summaryCard = buildSummaryCard(displaySkills, sessionDates, swimmer.firstName);
  const recentWins = buildRecentWins(displaySkills, catalogIndex);

  const hasAnyData =
    progress.skills.length > 0 ||
    progress.startProgress.some(
      (start) => start.grade.status !== "in_progress" || start.components.some((component) => component.current !== null),
    );

  const failedSections: string[] = [];
  if (sectionFailures.categories) failedSections.push("skill categories");
  if (sectionFailures.scoreHistory) failedSections.push("score history");

  // Parent progress response doesn't currently carry golf data; the
  // layout threads an empty array through GolfScoreList, which renders
  // nothing until an endpoint lands.
  const golfTrends: ParentGolfTrend[] = [];

  // Render-time constants for the two layouts. Keeping the expensive
  // computations out of JSX makes the subtree duplication cheap.
  const starts = (
    <ParentStartsBlock
      startProgress={progress.startProgress}
      swimmerSkills={progress.skills}
    />
  );
  const skills = (
    <ParentSkillsBlock
      skills={displaySkills}
      startProgress={progress.startProgress}
      categories={categories}
      rollups={latestScreenGroupRollups}
      nowIso={nowIso}
    />
  );

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 px-page pt-8 pb-20 tablet:pb-8">
        <div className="mx-auto max-w-content flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <a href="/dashboard" className="text-sm underline text-link">
              ← Dashboard
            </a>
            <h1
              className="text-heading text-text font-heading"
              style={{ fontSize: "clamp(1.75rem, 1.2rem + 2.5vw, 2.5rem)", fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
            >
              {swimmer.firstName}&apos;s Progress
            </h1>
          </div>

          {failedSections.length > 0 && (
            <InlineError
              message={`Couldn't load ${failedSections.join(", ")}. The rest of the page is current.`}
              reloadOnRetry
            />
          )}

          {!hasAnyData && (
            <p className="text-sm text-text-secondary">
              No evaluations recorded yet. Check back after the next practice session.
            </p>
          )}

          {hasAnyData && (
            <>
              {/* Phone + tablet: linear stack with per-region grids. */}
              <div
                className="flex flex-col gap-6 desktop:hidden"
                data-testid="parent-layout-mobile-tablet"
              >
                <SummaryCard data={summaryCard} firstName={swimmer.firstName} />
                <RecentWins
                  wins={recentWins}
                  swimmerFirstName={swimmer.firstName}
                  tabletVariant="cards"
                />
                <CoachNoteCard latestPriority={progress.latestCoachingPriority} />
                <section
                  className="flex flex-col gap-3"
                  aria-labelledby="parent-focus-heading-mobile-tablet"
                  data-testid="parent-layout-focus-slot"
                >
                  <h2
                    id="parent-focus-heading-mobile-tablet"
                    className="text-lg font-heading text-text"
                    style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
                  >
                    Working on next
                  </h2>
                  <CoachFocusList
                    workingOnNext={progress.coachingPriorities}
                    swimmerFirstName={swimmer.firstName}
                    skillsBySlug={skillsBySlug}
                    catalogIndex={catalogIndex}
                  />
                </section>
                {/* Snapshot + Starts: side-by-side on tablet, stacked on phone. */}
                <div
                  className="flex flex-col gap-6 tablet:grid tablet:grid-cols-2 tablet:gap-4 tablet:items-start"
                  data-testid="parent-layout-snapshot-starts"
                >
                  {categorySnapshot.length > 0 && (
                    <ParentSnapshotBlock
                      categorySnapshot={categorySnapshot}
                      firstSnapshot={firstSnapshot}
                    />
                  )}
                  {progress.startProgress.length > 0 && starts}
                </div>
                {skills}
                <GolfScoreList trends={golfTrends} variant="cards" />
              </div>

              {/* Desktop: 12-column grid with three rows. */}
              <div
                className="hidden desktop:grid desktop:gap-6 desktop:[grid-template-columns:repeat(12,minmax(0,1fr))] desktop:items-start"
                data-testid="parent-layout-desktop"
              >
                <div className="desktop:col-span-8 flex flex-col gap-6">
                  <SummaryCard data={summaryCard} firstName={swimmer.firstName} />
                  <CoachNoteCard latestPriority={progress.latestCoachingPriority} />
                </div>
                <div className="desktop:col-span-4 h-full">
                  <RecentWins
                    wins={recentWins}
                    swimmerFirstName={swimmer.firstName}
                    tabletVariant="cards"
                  />
                </div>
                <section
                  className="desktop:col-span-12 flex flex-col gap-3"
                  aria-labelledby="parent-focus-heading-desktop"
                  data-testid="parent-layout-focus-slot-desktop"
                >
                  <h2
                    id="parent-focus-heading-desktop"
                    className="text-lg font-heading text-text"
                    style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
                  >
                    Working on next
                  </h2>
                  <CoachFocusList
                    workingOnNext={progress.coachingPriorities}
                    swimmerFirstName={swimmer.firstName}
                    skillsBySlug={skillsBySlug}
                    catalogIndex={catalogIndex}
                  />
                </section>
                <div className="desktop:col-span-8">{skills}</div>
                <div
                  className="desktop:col-span-4 flex flex-col gap-6"
                  data-testid="parent-layout-side-stack"
                >
                  {categorySnapshot.length > 0 && (
                    <ParentSnapshotBlock
                      categorySnapshot={categorySnapshot}
                      firstSnapshot={firstSnapshot}
                      shortLabels
                    />
                  )}
                  {progress.startProgress.length > 0 && (
                    <ParentStartsBlock
                      startProgress={progress.startProgress}
                      swimmerSkills={progress.skills}
                      compact
                    />
                  )}
                  {golfTrends.length > 0 && (
                    <section
                      className="rounded-lg border p-4 flex flex-col gap-3"
                      style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-border)" }}
                      aria-labelledby="parent-golf-heading-desktop"
                    >
                      <h2
                        id="parent-golf-heading-desktop"
                        className="text-base font-heading text-text"
                        style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
                      >
                        Golf score
                      </h2>
                      <GolfScoreList trends={golfTrends} variant="compact" />
                    </section>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ── Snapshot block ───────────────────────────────────────────────────────

interface ParentSnapshotBlockProps {
  categorySnapshot: ReturnType<typeof latestScreenGroupSnapshot>;
  firstSnapshot: ReturnType<typeof firstScreenGroupSnapshot>;
  shortLabels?: boolean;
}

// Snapshot without the nested card. The outer section is the card; the
// radar sits inside it directly, capped at ~360/400/440px so its
// CSS-px labels stay close to body-text size at every breakpoint.
function ParentSnapshotBlock({ categorySnapshot, firstSnapshot, shortLabels = false }: ParentSnapshotBlockProps) {
  return (
    <section
      className="rounded-lg border p-4 flex flex-col gap-2"
      style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-border)" }}
      aria-labelledby="parent-snapshot-heading"
      data-testid="parent-progress-snapshot"
    >
      <h2
        id="parent-snapshot-heading"
        className="text-base font-heading text-text"
        style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
      >
        Snapshot
      </h2>
      <div className="mx-auto w-full max-w-[360px] tablet:max-w-[400px] desktop:max-w-[280px]">
        <CategoryRadar
          categories={categorySnapshot}
          {...(firstSnapshot.length > 0 && { firstEvaluation: firstSnapshot })}
          shortLabels={shortLabels}
        />
      </div>
    </section>
  );
}

// ── Starts block ─────────────────────────────────────────────────────────

interface ParentStartsBlockProps {
  startProgress: ParentSwimmerProgressResponse["startProgress"];
  swimmerSkills: ParentSwimmerProgressResponse["skills"];
  compact?: boolean;
}

function ParentStartsBlock({ startProgress, swimmerSkills, compact = false }: ParentStartsBlockProps) {
  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="parent-starts-heading"
      data-testid="parent-progress-starts"
    >
      <h2
        id="parent-starts-heading"
        className="text-base font-heading text-text"
        style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
      >
        Starts
      </h2>
      <StartsSection
        startProgress={startProgress}
        swimmerSkills={swimmerSkills.map((skill) => ({
          slug: skill.slug,
          history: skill.history,
        }))}
        showSessionGrid={false}
        showStillToGrade={false}
        compact={compact}
      />
    </section>
  );
}

// ── Skills block ─────────────────────────────────────────────────────────

interface ParentSkillsBlockProps {
  skills: ReadonlyArray<ParentSkillProgress>;
  startProgress: ParentSwimmerProgressResponse["startProgress"];
  categories: ParentCategoriesResponse;
  rollups: ReadonlyArray<{
    screenSlug: string;
    name: string;
    average: number | null;
    assessedCount: number;
    totalCount: number;
  }>;
  nowIso: string;
}

function ParentSkillsBlock({ skills, startProgress, categories, rollups, nowIso }: ParentSkillsBlockProps) {
  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="parent-skills-heading"
      data-testid="parent-progress-skills"
    >
      <h2
        id="parent-skills-heading"
        className="text-lg font-heading text-text"
        style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
      >
        Skills
      </h2>
      <ParentStrokeGroupsPanel
        skills={skills}
        startProgress={startProgress}
        categories={categories}
        nowIso={nowIso}
        rollups={rollups}
      />
    </section>
  );
}
