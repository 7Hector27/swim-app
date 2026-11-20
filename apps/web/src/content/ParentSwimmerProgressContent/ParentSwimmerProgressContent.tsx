import type {
  ParentCategoriesResponse,
  ParentGolfScoreTrendsResponse,
  ParentScoreHistoryResponse,
  ParentSkillProgress,
  ParentSwimmer,
  ParentSwimmerProgressResponse,
} from "@swim-app/shared";
import InlineError from "@/components/InlineError";
import StartsSection from "@/components/StartsSection";
import WhereSheStands, { buildLanes } from "@/components/WhereSheStands";
import CategoryRadar from "@/content/SwimmerProgressContent/charts/CategoryRadar";
import { firstScreenGroupSnapshot, latestScreenGroupSnapshot } from "@/lib/progressCharts";
import { buildCatalogIndex } from "@/lib/screenGroups";
import ParentStrokeGroupsPanel from "./ParentStrokeGroupsPanel";
import CoachFocusList from "./sections/CoachFocusList";
import CoachNoteCard from "./sections/CoachNoteCard";
import GolfScoreList from "./sections/GolfScoreList";
import RecentWins from "./sections/RecentWins";
import SummaryCard from "./sections/SummaryCard";
import { buildRecentWins, buildSummaryCard } from "./helpers";

// Per-section failure flags. `progress` is primary (the page throws if it
// fails), so it isn't listed. Defaults to all false, keeping existing tests
// that don't pass this prop green.
export interface ParentSwimmerProgressSectionFailures {
  categories?: boolean;
  scoreHistory?: boolean;
  golfScore?: boolean;
}

interface ParentSwimmerProgressContentProps {
  swimmer: ParentSwimmer;
  progress: ParentSwimmerProgressResponse;
  categories: ParentCategoriesResponse;
  scoreHistory?: ParentScoreHistoryResponse;
  golfScore?: ParentGolfScoreTrendsResponse;
  sectionFailures?: ParentSwimmerProgressSectionFailures;
}

const EMPTY_SCORE_HISTORY: ParentScoreHistoryResponse = {
  points: [],
  recentChanges: [],
  milestones: [],
  measurements: [],
};

const EMPTY_GOLF: ParentGolfScoreTrendsResponse = { trends: [] };

// Parent progress page, laid out to match the coach mock minus coach-only
// sections (faults, session grid, evaluations-by-week, coach notes).
//
// Order on every breakpoint:
//   1. Header
//   2. Top row — Summary (2/3) + Wins (1/3) on tablet+, stacked on phone
//   3. Coach's note (when present) + Working on next (3 equal cards)
//   4. Snapshot (half) + Where she stands (half) on tablet+, stacked phone
//   5. Skills (full width)
//   6. Starts (full width, full names, no session grid)
//   7. Golf score (full width) — the whole section is absent when the
//      swimmer has no golf scores
//
// Each section mounts exactly once; there's no breakpoint-cloned subtree.
export default function ParentSwimmerProgressContent({
  swimmer,
  progress,
  categories,
  scoreHistory = EMPTY_SCORE_HISTORY,
  golfScore = EMPTY_GOLF,
  sectionFailures = {},
}: ParentSwimmerProgressContentProps) {
  const categorySnapshot = latestScreenGroupSnapshot(scoreHistory);
  const firstSnapshot = firstScreenGroupSnapshot(scoreHistory);
  const lanes = buildLanes(firstSnapshot, categorySnapshot);
  // Radar's dashed first-evaluation outline only makes sense when the
  // swimmer has more than one session — on a single-session swimmer it
  // overlays an identical shape. WhereSheStands always ships both
  // snapshots because its "first equals current" state is a visible dot
  // anchor, not a duplicate.
  const radarFirstEvaluation = scoreHistory.points.length >= 2 ? firstSnapshot : [];

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
  if (sectionFailures.golfScore) failedSections.push("golf score");

  // Golf hides the whole section (heading included) when there's nothing
  // meaningful to show. A trend counts as "has data" only when at least
  // one point in it carries both time + strokes — a partial measurement
  // that can't form a golf score shouldn't surface the section at all.
  const golfVisible = golfScore.trends.some((trend) =>
    trend.byCategory.some((cat) =>
      cat.points.some((point) => point.timeSeconds !== null && point.strokeCountValue !== null),
    ),
  );
  const startsVisible = progress.startProgress.length > 0;
  // Both charts in row 3 share a single visibility toggle so the row
  // never leaves a lonely chart hanging.
  const groupRowVisible = categorySnapshot.length > 0;

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 px-page pt-8 pb-20 tablet:pb-8">
        <div
          className="@container/progress mx-auto max-w-content flex flex-col gap-6"
          data-testid="parent-progress-layout"
        >
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
              {/* Row 2 — Summary (2/3) + Wins (1/3) on tablet+ */}
              <div
                className="grid grid-cols-1 tablet:grid-cols-3 gap-6 items-start"
                data-testid="parent-progress-top-row"
              >
                <div className="tablet:col-span-2 min-w-0">
                  <SummaryCard data={summaryCard} firstName={swimmer.firstName} />
                </div>
                <div className="tablet:col-span-1 min-w-0">
                  <RecentWins wins={recentWins} swimmerFirstName={swimmer.firstName} />
                </div>
              </div>

              {/* Row 3 — Coach's note (when present) + Working on next */}
              {progress.latestCoachingPriority && (
                <CoachNoteCard latestPriority={progress.latestCoachingPriority} />
              )}
              <section
                className="flex flex-col gap-3"
                aria-labelledby="parent-focus-heading"
                data-testid="parent-progress-focus"
              >
                <h2
                  id="parent-focus-heading"
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

              {/* Row 4 — Snapshot + Where she stands.
                  Two columns only when the content container is wide
                  enough to give each column ~420px plus the 24px gap
                  (2×420 + 24 = 864). Below that the row stacks and
                  each card gets full content width, so WhereSheStands
                  can sit in its 4-col arrangement without crowding. */}
              {groupRowVisible && (
                <div
                  className="grid grid-cols-1 @min-[864px]/progress:grid-cols-2 gap-6 items-start"
                  data-testid="parent-progress-group-row"
                >
                  <section
                    className="flex flex-col gap-3 min-w-0"
                    aria-labelledby="parent-snapshot-heading"
                    data-testid="parent-progress-snapshot"
                  >
                    <h2
                      id="parent-snapshot-heading"
                      className="text-lg font-heading text-text"
                      style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
                    >
                      Snapshot
                    </h2>
                    <CategoryRadar
                      categories={categorySnapshot}
                      {...(radarFirstEvaluation.length > 0 && { firstEvaluation: radarFirstEvaluation })}
                    />
                  </section>
                  <section
                    className="flex flex-col gap-3 min-w-0"
                    aria-labelledby="parent-where-heading"
                    data-testid="parent-progress-where-she-stands"
                  >
                    <h2
                      id="parent-where-heading"
                      className="text-lg font-heading text-text"
                      style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
                    >
                      Where she stands
                    </h2>
                    <WhereSheStands lanes={lanes} />
                  </section>
                </div>
              )}

              {/* Row 5 — Skills */}
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
                  skills={displaySkills}
                  startProgress={progress.startProgress}
                  categories={categories}
                  nowIso={nowIso}
                  rollups={latestScreenGroupRollups}
                />
              </section>

              {/* Row 6 — Starts */}
              {startsVisible && (
                <section
                  className="flex flex-col gap-3"
                  aria-labelledby="parent-starts-heading"
                  data-testid="parent-progress-starts"
                >
                  <h2
                    id="parent-starts-heading"
                    className="text-lg font-heading text-text"
                    style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
                  >
                    Starts
                  </h2>
                  <StartsSection
                    startProgress={progress.startProgress}
                    swimmerSkills={progress.skills.map((skill) => ({ slug: skill.slug, history: skill.history }))}
                    showSessionGrid={false}
                    showStillToGrade={false}
                  />
                </section>
              )}

              {/* Row 7 — Golf score (section hidden entirely when empty) */}
              {golfVisible && (
                <section
                  className="flex flex-col gap-3"
                  aria-labelledby="parent-golf-heading"
                  data-testid="parent-progress-golf"
                >
                  <h2
                    id="parent-golf-heading"
                    className="text-lg font-heading text-text"
                    style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
                  >
                    Golf score
                  </h2>
                  <p className="text-xs text-text-secondary">
                    Seconds plus strokes for one length. Lower is better.
                  </p>
                  <GolfScoreList trends={golfScore.trends} />
                  <p className="text-xs text-text-secondary">
                    The shaded band is the typical range for her age group.
                  </p>
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
