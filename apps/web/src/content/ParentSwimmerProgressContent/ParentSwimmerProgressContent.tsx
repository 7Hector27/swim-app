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

// Single-tree responsive layout. Each section mounts once; the root
// grid swaps grid-template-areas per breakpoint:
//
//   Phone (≤768px): one column, DOM reading order.
//   Tablet (769-1247px): 2-col rows for snapshot+starts; wins and
//     focus render as card rows internally.
//   Desktop (≥1248px): 12-col grid with Summary+Note stacked in the
//     left 8 cols / Wins stretched on the right 4; focus row full-
//     width; Skills left 8 / Snapshot+Starts+Golf stacked right 4.
//
// Dual-form components (Wins list vs cards, Starts full vs compact,
// Radar long vs short labels, Golf cards vs compact list) each handle
// their own viewport switch internally — one DOM instance, one copy
// of their state (Starts tab selection, open skill row) that survives
// a breakpoint change.
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

  const golfVisible = golfScore.trends.length > 0;
  const startsVisible = progress.startProgress.length > 0;
  const snapshotVisible = categorySnapshot.length > 0;

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
            <div
              className="parent-progress-grid"
              data-testid="parent-progress-layout"
            >
              <div className="[grid-area:summary]">
                <SummaryCard data={summaryCard} firstName={swimmer.firstName} />
              </div>
              <div className="[grid-area:wins]">
                <RecentWins wins={recentWins} swimmerFirstName={swimmer.firstName} />
              </div>
              <div className="[grid-area:note]">
                <CoachNoteCard latestPriority={progress.latestCoachingPriority} />
              </div>
              <section
                className="[grid-area:focus] flex flex-col gap-3"
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
              {snapshotVisible && (
                <section
                  className="[grid-area:snapshot] rounded-lg border p-4 flex flex-col gap-2"
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
                      shortLabelsOnDesktop
                    />
                  </div>
                </section>
              )}
              {startsVisible && (
                <section
                  className="[grid-area:starts] flex flex-col gap-3"
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
                    startProgress={progress.startProgress}
                    swimmerSkills={progress.skills.map((skill) => ({ slug: skill.slug, history: skill.history }))}
                    showSessionGrid={false}
                    showStillToGrade={false}
                    compactOnDesktop
                  />
                </section>
              )}
              <section
                className="[grid-area:skills] flex flex-col gap-3"
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
              {golfVisible && (
                <section
                  className="[grid-area:golf] rounded-lg border p-4 flex flex-col gap-3 desktop:rounded-lg desktop:border desktop:p-4"
                  style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-border)" }}
                  aria-labelledby="parent-golf-heading"
                  data-testid="parent-progress-golf"
                >
                  <h2
                    id="parent-golf-heading"
                    className="text-base font-heading text-text"
                    style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
                  >
                    Golf score
                  </h2>
                  <GolfScoreList trends={golfScore.trends} />
                </section>
              )}
            </div>
          )}
        </div>
      </main>
      <ParentProgressGridStyles />
    </div>
  );
}

// Grid-template-areas definitions kept in one inline <style> so the
// three breakpoints' layouts live together next to the component they
// drive. Using Tailwind arbitrary values here would produce an
// unreadable classname 300 characters long.
function ParentProgressGridStyles() {
  return (
    <style>{`
      .parent-progress-grid {
        display: grid;
        gap: 1.5rem;
        grid-template-columns: 1fr;
        grid-template-areas:
          "summary"
          "wins"
          "note"
          "focus"
          "snapshot"
          "starts"
          "skills"
          "golf";
        align-items: start;
      }

      @media (min-width: 769px) {
        .parent-progress-grid {
          grid-template-columns: 1fr 1fr;
          grid-template-areas:
            "summary summary"
            "wins wins"
            "note note"
            "focus focus"
            "snapshot starts"
            "skills skills"
            "golf golf";
        }
      }

      @media (min-width: 1248px) {
        .parent-progress-grid {
          grid-template-columns: repeat(12, minmax(0, 1fr));
          grid-template-areas:
            "summary summary summary summary summary summary summary summary wins wins wins wins"
            "note note note note note note note note wins wins wins wins"
            "focus focus focus focus focus focus focus focus focus focus focus focus"
            "skills skills skills skills skills skills skills skills snapshot snapshot snapshot snapshot"
            "skills skills skills skills skills skills skills skills starts starts starts starts"
            "skills skills skills skills skills skills skills skills golf golf golf golf";
        }
      }
    `}</style>
  );
}
