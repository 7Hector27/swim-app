import type { ParentSwimmer, ParentSwimmerProgressResponse, CategoriesResponse, StartGradeResult } from "@swim-app/shared";
import ParentNav from "@/components/ParentNav";
import SiteFooter from "@/components/SiteFooter";
import ParentSkillProgressRow from "./ParentSkillProgressRow";
import { formatStartGradeDisplay, currentLevelDisplay, currentLevelIsDanger } from "./helpers";

interface ParentSwimmerProgressContentProps {
  swimmer: ParentSwimmer;
  progress: ParentSwimmerProgressResponse;
  categories: CategoriesResponse;
}

function startGradeIsDanger(result: StartGradeResult): boolean {
  return result.status === "not_legal";
}

export default function ParentSwimmerProgressContent({
  swimmer,
  progress,
  categories,
}: ParentSwimmerProgressContentProps) {
  const slugToName = new Map<string, string>();
  for (const cat of categories) {
    for (const skill of cat.skills) {
      slugToName.set(skill.slug, skill.name);
    }
  }
  for (const skill of progress.skills) {
    slugToName.set(skill.slug, skill.name);
  }
  for (const start of progress.startProgress) {
    slugToName.set(start.slug, start.name);
    for (const comp of start.components) {
      slugToName.set(comp.slug, comp.name);
    }
  }

  const getSlugName = (slug: string): string => slugToName.get(slug) ?? slug;

  const startParentSlugs = new Set(progress.startProgress.map((start) => start.slug));
  const startComponentSlugs = new Set(
    progress.startProgress.flatMap((start) => start.components.map((component) => component.slug)),
  );

  const displaySkills = progress.skills.filter(
    (skill) => !startParentSlugs.has(skill.slug) && !startComponentSlugs.has(skill.slug),
  );

  const categoryOrder = categories.map((category) => category.id);
  const skillsByCategory = new Map<string, { categoryName: string; skills: typeof displaySkills }>();

  for (const skill of displaySkills) {
    const existing = skillsByCategory.get(skill.categoryId);
    if (existing) {
      existing.skills.push(skill);
    } else {
      skillsByCategory.set(skill.categoryId, { categoryName: skill.categoryName, skills: [skill] });
    }
  }

  for (const cat of categories) {
    if (!skillsByCategory.has(cat.id) && cat.skills.length > 0) {
      skillsByCategory.set(cat.id, { categoryName: cat.name, skills: [] });
    }
  }

  const orderedCategories = [
    ...categoryOrder
      .filter((id) => skillsByCategory.has(id))
      .map((id) => ({ id, ...skillsByCategory.get(id)! })),
    ...[...skillsByCategory.entries()]
      .filter(([id]) => !categoryOrder.includes(id))
      .map(([id, data]) => ({ id, ...data })),
  ];

  const hasAnyData =
    progress.skills.length > 0 ||
    progress.startProgress.some(
      (start) => start.grade.status !== "in_progress" || start.components.some((component) => component.current !== null),
    );

  return (
    <div className="flex flex-col min-h-screen">
      <ParentNav />
      <main className="flex-1 px-page pt-8 pb-tab-safe tablet:pb-8">
        <div className="mx-auto max-w-content flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <a
              href="/dashboard"
              className="text-sm underline text-link"
            >
              ← Dashboard
            </a>
            <h1 className="text-heading text-text">
              {swimmer.firstName}&apos;s Progress
            </h1>
          </div>

          {!hasAnyData && (
            <p className="text-sm text-text-secondary">
              No evaluations recorded yet — check back after the next practice session.
            </p>
          )}

          {/* What to work on next */}
          {progress.coachingPriorities.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-bold text-sm text-text">
                What to work on next
              </h2>
              <ul className="flex flex-col gap-2">
                {progress.coachingPriorities.slice(0, 3).map((priority) => {
                  const deepest = priority.chain[priority.chain.length - 1];
                  return (
                    <li key={priority.targetSlug} className="text-sm text-text">
                      <span className="font-semibold">{priority.targetName}</span>
                      {deepest && deepest.slug !== priority.targetSlug && (
                        <>
                          {" → "}
                          <span>
                            {priority.chain.map((entry, index) => (
                              <span key={entry.slug}>
                                {index > 0 && " → "}
                                <span style={entry.notAssessed ? { color: "var(--color-text-secondary)" } : undefined}>
                                  {entry.name}
                                  {entry.notAssessed ? " (not assessed yet — check it)" : ""}
                                </span>
                              </span>
                            ))}
                          </span>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Head position overall */}
          {progress.headPositionOverall !== null && (
            <section className="flex flex-col gap-1">
              <h2 className="font-bold text-sm text-text">
                Head Position Overall
              </h2>
              <p className="text-2xl font-bold text-accent">
                {progress.headPositionOverall}
              </p>
            </section>
          )}

          {/* Starts */}
          {progress.startProgress.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-bold text-sm text-text">
                Starts
              </h2>
              <ul className="flex flex-col gap-3">
                {progress.startProgress.map((start) => {
                  const gradeText = formatStartGradeDisplay(start.grade, getSlugName);
                  const isDanger = startGradeIsDanger(start.grade);
                  return (
                    <li key={start.slug} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-text">
                          {start.name}
                        </span>
                        <span
                          className="text-xs font-semibold px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: isDanger ? "var(--color-danger)" : "var(--color-border)",
                            color: isDanger ? "var(--color-on-danger)" : "var(--color-text)",
                          }}
                        >
                          {gradeText}
                        </span>
                      </div>
                      <ul className="flex flex-col gap-0.5 pl-3 border-l border-border">
                        {start.components.map((comp) => (
                          <li key={comp.slug} className="flex items-center gap-2 text-xs">
                            <span className="text-text-secondary flex-1">{comp.name}</span>
                            {comp.current !== null ? (
                              <span
                                className="font-semibold px-1 py-0.5 rounded"
                                style={{
                                  backgroundColor: currentLevelIsDanger(comp.current)
                                    ? "var(--color-danger)"
                                    : "var(--color-border)",
                                  color: currentLevelIsDanger(comp.current)
                                    ? "var(--color-on-danger)"
                                    : "var(--color-text)",
                                }}
                              >
                                {currentLevelDisplay(comp.current)}
                              </span>
                            ) : (
                              <span className="text-text-secondary">Not assessed</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Category skill cards */}
          {orderedCategories.map(({ id, categoryName, skills: catSkills }) => {
            const assessedIds = new Set(catSkills.map((skill) => skill.skillId));
            const catFromCategories = categories.find((category) => category.id === id);

            const notAssessedSkills = catFromCategories
              ? catFromCategories.skills.filter(
                  (skill) =>
                    !assessedIds.has(skill.id) &&
                    !startParentSlugs.has(skill.slug) &&
                    !startComponentSlugs.has(skill.slug),
                )
              : [];

            return (
              <section key={id} className="flex flex-col gap-2">
                <h2 className="font-bold text-sm text-text">
                  {categoryName}
                </h2>
                <ul className="flex flex-col gap-0">
                  {catSkills.map((skill) => (
                    <ParentSkillProgressRow key={skill.skillId} skill={skill} />
                  ))}
                  {notAssessedSkills.map((skill) => (
                    <li
                      key={skill.id}
                      className="flex items-center justify-between border-b border-border py-2 text-sm min-h-[44px]"
                    >
                      <span className="text-text">{skill.name}</span>
                      <span className="text-xs text-text-secondary">Not assessed</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
