import { type CoachSwimmerDetail, type League, type CategoriesResponse, type SwimmerSkillsResponse, type StartGradeResult } from "@swim-app/shared";

import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";
import HidePublicButton from "./HidePublicButton";
import SwimmerSkillsHistory from "./SwimmerSkillsHistory";

interface CoachSwimmerDetailContentProps {
  swimmer: CoachSwimmerDetail;
  accessToken: string;
  grades: SwimmerSkillsResponse["grades"];
  startGrades: SwimmerSkillsResponse["startGrades"];
  coachingPriorities: SwimmerSkillsResponse["coachingPriorities"];
  categories: CategoriesResponse;
}

const LEAGUE_LABELS: Record<League, string> = {
  club: "Club",
  summer_league: "Summer League",
};

function gradeDisplay(grade: number | "not_legal" | "no_concept"): string {
  if (grade === "not_legal") return "DQ";
  if (grade === "no_concept") return "NC";
  return String(grade);
}

function formatStartGrade(result: StartGradeResult, slugToName: Map<string, string>): string {
  if (result.status === "not_legal") return "DQ";
  if (result.status === "no_concept") return "NC";
  if (result.status === "graded") return String(result.grade);
  if (result.missing.length === 0) return "In progress";
  const names = result.missing.slice(0, 2).map((slug) => slugToName.get(slug) ?? slug).join(", ");
  return `In progress — needs ${names}`;
}

export default function CoachSwimmerDetailContent({
  swimmer,
  accessToken,
  grades,
  startGrades,
  coachingPriorities,
  categories,
}: CoachSwimmerDetailContentProps) {

  return (
    <div className="flex flex-col min-h-screen">
      <SiteNav />
      <main className="flex-1 px-page py-16">
        <div className="mx-auto max-w-content flex flex-col gap-8">
          <div>
            <a
              href="/coach/swimmers"
              className="text-sm text-link underline hover:text-link-hover mb-4 inline-block"
            >
              ← All swimmers
            </a>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-heading">
                {swimmer.firstName} {swimmer.lastName}
              </h1>
              {!swimmer.isPublic && (
                <span className="text-xs text-text-secondary border border-border rounded px-2 py-0.5">
                  Hidden from public
                </span>
              )}
            </div>
          </div>

          {/* Evaluate button */}
          <div>
            <a
              href={`/coach/swimmers/${swimmer.id}/evaluate`}
              className="inline-flex items-center justify-center px-5 min-h-[44px] font-bold text-sm rounded"
              style={{
                borderRadius: "var(--radius-button)",
                backgroundColor: "var(--color-button-primary-background)",
                color: "var(--color-button-primary-text)",
              }}
            >
              Evaluate {swimmer.firstName}
            </a>
          </div>

          <section className="flex flex-col gap-2">
            <h2 className="font-bold text-text">Details</h2>
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex gap-2">
                <dt className="text-text-secondary w-24 shrink-0">Age</dt>
                <dd className="text-text">{swimmer.age}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-text-secondary w-24 shrink-0">Sex</dt>
                <dd className="text-text capitalize">{swimmer.sex}</dd>
              </div>
            </dl>
          </section>

          {categories.length > 0 && (() => {
            const categoriesWithData = categories.filter((cat) => {
              const startParentIds = new Set(
                cat.skills.filter((s) => s.parentSkillId !== null).map((s) => s.parentSkillId!),
              );
              return cat.skills.some((skill) => {
                if (startParentIds.has(skill.id)) return startGrades[skill.slug] !== undefined;
                if (skill.ratedPerSide) {
                  return grades[`${skill.slug}:left`] !== undefined || grades[`${skill.slug}:right`] !== undefined;
                }
                return grades[skill.slug] !== undefined;
              });
            });
            if (categoriesWithData.length === 0) return null;
            return (
              <section className="flex flex-col gap-3">
                <h2 className="font-bold text-text">Current Levels</h2>
                {categoriesWithData.map((category) => {
                  const startParentIds = new Set(
                    category.skills.filter((s) => s.parentSkillId !== null).map((s) => s.parentSkillId!),
                  );
                  const slugToNameMap = new Map(category.skills.map((s) => [s.slug, s.name]));
                  const startParents = category.skills.filter(
                    (skill) => startParentIds.has(skill.id) && startGrades[skill.slug] !== undefined,
                  );
                  const ratedSkills = category.skills.filter((skill) => {
                    if (startParentIds.has(skill.id)) return false;
                    if (skill.ratedPerSide) {
                      return grades[`${skill.slug}:left`] !== undefined || grades[`${skill.slug}:right`] !== undefined;
                    }
                    return grades[skill.slug] !== undefined;
                  });
                  return (
                    <div key={category.id} className="flex flex-col gap-1">
                      <p className="text-xs font-semibold text-text-secondary">{category.name}</p>
                      <dl className="flex flex-col gap-1">
                        {startParents.map((skill) => (
                          <div key={skill.id} className="flex gap-2 text-sm">
                            <dt className="text-text-secondary w-48 shrink-0">{skill.name}</dt>
                            <dd className="font-semibold text-text">
                              {formatStartGrade(startGrades[skill.slug]!, slugToNameMap)}
                            </dd>
                          </div>
                        ))}
                        {ratedSkills.map((skill) => {
                          if (skill.ratedPerSide) {
                            return (
                              <div key={skill.id} className="flex gap-2 text-sm">
                                <dt className="text-text-secondary w-48 shrink-0">{skill.name}</dt>
                                <dd className="text-text flex gap-2">
                                  {grades[`${skill.slug}:left`] !== undefined && (
                                    <span>L: <span className="font-semibold">{gradeDisplay(grades[`${skill.slug}:left`]!)}</span></span>
                                  )}
                                  {grades[`${skill.slug}:right`] !== undefined && (
                                    <span>R: <span className="font-semibold">{gradeDisplay(grades[`${skill.slug}:right`]!)}</span></span>
                                  )}
                                </dd>
                              </div>
                            );
                          }
                          const grade = grades[skill.slug];
                          if (grade === undefined) return null;
                          return (
                            <div key={skill.id} className="flex gap-2 text-sm">
                              <dt className="text-text-secondary w-48 shrink-0">{skill.name}</dt>
                              <dd className="font-semibold text-text">{gradeDisplay(grade)}</dd>
                            </div>
                          );
                        })}
                      </dl>
                    </div>
                  );
                })}
                {coachingPriorities.length > 0 && (() => {
                  const slugToName = new Map<string, string>();
                  for (const cat of categories) {
                    for (const skill of cat.skills) {
                      slugToName.set(skill.slug, skill.name);
                    }
                  }
                  const suggestions = coachingPriorities
                    .map((priority) => {
                      const lastSlug = priority.chain[priority.chain.length - 1]?.slug;
                      if (!lastSlug) return null;
                      return slugToName.get(lastSlug) ?? lastSlug;
                    })
                    .filter((name): name is string => name !== null);
                  const uniqueSuggestions = [...new Set(suggestions)].slice(0, 3);
                  if (uniqueSuggestions.length === 0) return null;
                  return (
                    <div className="flex flex-col gap-1">
                      <p className="text-xs font-semibold text-text-secondary">Coaching priorities</p>
                      <ul className="flex flex-col gap-0.5 text-sm">
                        {uniqueSuggestions.map((name) => (
                          <li key={name} className="text-text">Focus on <span className="font-semibold">{name}</span></li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
              </section>
            );
          })()}

          {swimmer.currentLeagues.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="font-bold text-text">Leagues</h2>
              <div className="flex gap-2 flex-wrap">
                {swimmer.currentLeagues.map((league) => (
                  <span
                    key={league}
                    className="text-xs font-semibold text-accent border border-accent rounded px-2 py-0.5"
                  >
                    {LEAGUE_LABELS[league]}
                  </span>
                ))}
              </div>
            </section>
          )}

          {swimmer.clubs.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="font-bold text-text">Clubs</h2>
              <ul className="flex flex-col gap-1 text-sm text-text">
                {swimmer.clubs.map((club) => (
                  <li key={club.id}>
                    {club.otherClubName !== null ? club.otherClubName : club.clubId}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <SwimmerSkillsHistory
            swimmerId={swimmer.id}
            accessToken={accessToken}
            categories={categories}
            grades={grades}
          />

          {swimmer.members.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-bold text-text">Household</h2>
              <ul className="flex flex-col gap-3">
                {swimmer.members.map((guardian) => (
                  <li key={`${guardian.fullName ?? ""}\u001f${guardian.phone ?? ""}`} className="flex flex-col gap-1 text-sm">
                    <p className="text-text font-semibold">{guardian.fullName ?? "—"}</p>
                    {guardian.phone !== null && (
                      <a
                        href={`tel:${guardian.phone}`}
                        className="text-link underline hover:text-link-hover"
                      >
                        {guardian.phone}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {swimmer.isPublic && (
            <section>
              <HidePublicButton swimmerId={swimmer.id} firstName={swimmer.firstName} />
            </section>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
