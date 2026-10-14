"use client";

import { useState } from "react";
import type { CategoriesResponse, CoachSkillRating } from "@swim-app/shared";
import { fetchSkillRatingHistory, voidRating } from "@/lib/api/evaluations";

interface SwimmerSkillsHistoryProps {
  swimmerId: string;
  accessToken: string;
  categories: CategoriesResponse;
  grades: Record<string, number | "not_legal" | "no_concept">;
}

type HistoryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; ratings: CoachSkillRating[] };

function gradeLabel(grade: number | null, noConcept: boolean, notLegal: boolean): string {
  if (notLegal) return "DQ";
  if (noConcept) return "NC";
  if (grade === null) return "—";
  return String(grade);
}

function formatDate(isoString: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(new Date(isoString));
}

export default function SwimmerSkillsHistory({
  swimmerId,
  accessToken,
  categories,
  grades,
}: SwimmerSkillsHistoryProps) {
  const [openSkillId, setOpenSkillId] = useState<string | null>(null);
  const [historyMap, setHistoryMap] = useState<Record<string, HistoryState>>({});
  const [voidingRatingId, setVoidingRatingId] = useState<string | null>(null);
  const [voidReasons, setVoidReasons] = useState<Record<string, string>>({});
  const [voidErrors, setVoidErrors] = useState<Record<string, string>>({});

  function hasGrade(skill: { slug: string; ratedPerSide: boolean }): boolean {
    if (skill.ratedPerSide) {
      return (
        grades[`${skill.slug}:left`] !== undefined ||
        grades[`${skill.slug}:right`] !== undefined
      );
    }
    return grades[skill.slug] !== undefined;
  }

  async function openSkill(skillId: string) {
    if (openSkillId === skillId) {
      setOpenSkillId(null);
      return;
    }
    setOpenSkillId(skillId);
    const current = historyMap[skillId];
    if (current && current.status !== "idle") return;
    setHistoryMap((prev) => ({ ...prev, [skillId]: { status: "loading" } }));
    const result = await fetchSkillRatingHistory(swimmerId, skillId, accessToken);
    if (result.ok) {
      setHistoryMap((prev) => ({ ...prev, [skillId]: { status: "loaded", ratings: result.ratings } }));
    } else {
      setHistoryMap((prev) => ({ ...prev, [skillId]: { status: "error" } }));
    }
  }

  async function handleVoidSubmit(skillId: string, ratingId: string) {
    const reason = voidReasons[ratingId] ?? "";
    if (!reason.trim()) return;
    const result = await voidRating(ratingId, reason.trim(), accessToken);
    if (!result.ok) {
      setVoidErrors((prev) => ({ ...prev, [ratingId]: "Failed to void rating. Please try again." }));
      return;
    }
    setVoidingRatingId(null);
    setVoidReasons((prev) => {
      const next = { ...prev };
      delete next[ratingId];
      return next;
    });
    setVoidErrors((prev) => {
      const next = { ...prev };
      delete next[ratingId];
      return next;
    });
    // Re-fetch history for this skill
    setHistoryMap((prev) => ({ ...prev, [skillId]: { status: "loading" } }));
    const histResult = await fetchSkillRatingHistory(swimmerId, skillId, accessToken);
    if (histResult.ok) {
      setHistoryMap((prev) => ({ ...prev, [skillId]: { status: "loaded", ratings: histResult.ratings } }));
    }
  }

  const ratedCategories = categories.filter((cat) =>
    cat.skills.some((skill) => hasGrade(skill)),
  );

  if (ratedCategories.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-bold text-sm text-text">Skill History</h2>
      {ratedCategories.map((category) => {
        const ratedSkills = category.skills.filter((skill) => hasGrade(skill));
        return (
          <div key={category.id} className="flex flex-col gap-1">
            <p className="text-xs font-semibold text-text-secondary">{category.name}</p>
            <ul className="flex flex-col gap-0">
              {ratedSkills.map((skill) => {
                const isOpen = openSkillId === skill.id;
                const historyState = historyMap[skill.id] ?? { status: "idle" };
                const leftGrade = grades[`${skill.slug}:left`];
                const rightGrade = grades[`${skill.slug}:right`];
                const singleGrade = skill.ratedPerSide ? undefined : grades[skill.slug];

                function badgeStyle(grade: number | "not_legal" | "no_concept") {
                  return {
                    backgroundColor: grade === "not_legal" ? "var(--color-danger)" : "var(--color-border)",
                    color: grade === "not_legal" ? "var(--color-on-danger)" : "var(--color-text)",
                  };
                }
                function badgeText(grade: number | "not_legal" | "no_concept") {
                  if (grade === "not_legal") return "DQ";
                  if (grade === "no_concept") return "NC";
                  return String(grade);
                }

                return (
                  <li key={skill.id} className="border-b border-border">
                    <button
                      type="button"
                      onClick={() => {
                        void openSkill(skill.id);
                      }}
                      className="w-full flex items-center justify-between py-2 text-sm text-left min-h-[44px] text-text"
                      aria-expanded={isOpen}
                    >
                      <span>{skill.name}</span>
                      <span className="flex items-center gap-2">
                        {skill.ratedPerSide ? (
                          <>
                            {leftGrade !== undefined && (
                              <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={badgeStyle(leftGrade)}>
                                L {badgeText(leftGrade)}
                              </span>
                            )}
                            {rightGrade !== undefined && (
                              <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={badgeStyle(rightGrade)}>
                                R {badgeText(rightGrade)}
                              </span>
                            )}
                          </>
                        ) : (
                          singleGrade !== undefined && (
                            <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={badgeStyle(singleGrade)}>
                              {badgeText(singleGrade)}
                            </span>
                          )
                        )}
                        <span aria-hidden="true">{isOpen ? "▲" : "▼"}</span>
                      </span>
                    </button>

                    {isOpen && (
                      <div className="pb-3 flex flex-col gap-2">
                        {historyState.status === "loading" && (
                          <p className="text-xs text-text-secondary">Loading…</p>
                        )}
                        {historyState.status === "error" && (
                          <p className="text-xs" style={{ color: "var(--color-danger)" }}>
                            Failed to load history.
                          </p>
                        )}
                        {historyState.status === "loaded" &&
                          historyState.ratings.length === 0 && (
                            <p className="text-xs text-text-secondary">No ratings yet.</p>
                          )}
                        {historyState.status === "loaded" &&
                          historyState.ratings.map((rating) => {
                            const isVoided = rating.voidedAt !== null;
                            const isVoiding = voidingRatingId === rating.id;
                            return (
                              <div
                                key={rating.id}
                                className="flex flex-col gap-1 pl-2 text-xs"
                                style={{ opacity: isVoided ? 0.5 : 1 }}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-text-secondary">
                                    {formatDate(rating.ratedAt)}
                                  </span>
                                  <span
                                    className="font-semibold px-1.5 py-0.5 rounded"
                                    style={{
                                      backgroundColor: rating.notLegal
                                        ? "var(--color-danger)"
                                        : "var(--color-border)",
                                      color: rating.notLegal ? "var(--color-on-danger)" : "var(--color-text)",
                                    }}
                                  >
                                    {gradeLabel(rating.grade, rating.noConcept, rating.notLegal)}
                                  </span>
                                  {isVoided && (
                                    <span className="text-text-secondary">Voided</span>
                                  )}
                                  {!isVoided && !isVoiding && (
                                    <button
                                      type="button"
                                      onClick={() => setVoidingRatingId(rating.id)}
                                      className="underline min-h-[44px] px-1"
                                      style={{ color: "var(--color-danger)" }}
                                    >
                                      Void
                                    </button>
                                  )}
                                </div>
                                {rating.note !== null && (
                                  <p className="text-text-secondary">{rating.note}</p>
                                )}
                                {isVoiding && (
                                  <div className="flex flex-col gap-1 mt-1">
                                    <textarea
                                      value={voidReasons[rating.id] ?? ""}
                                      onChange={(event) =>
                                        setVoidReasons((prev) => ({
                                          ...prev,
                                          [rating.id]: event.target.value,
                                        }))
                                      }
                                      rows={2}
                                      placeholder="Reason (required)"
                                      aria-label="Void reason"
                                      className="border rounded px-2 py-1 text-xs resize-y border-border text-text bg-transparent"
                                    />
                                    {voidErrors[rating.id] && (
                                      <p role="alert" style={{ color: "var(--color-danger)" }}>
                                        {voidErrors[rating.id]}
                                      </p>
                                    )}
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void handleVoidSubmit(skill.id, rating.id);
                                        }}
                                        disabled={!(voidReasons[rating.id] ?? "").trim()}
                                        className="text-xs font-semibold px-3 min-h-[44px] rounded"
                                        style={{
                                          backgroundColor: "var(--color-danger)",
                                          color: "var(--color-on-danger)",
                                          opacity: (voidReasons[rating.id] ?? "").trim() ? 1 : 0.5,
                                          cursor: (voidReasons[rating.id] ?? "").trim()
                                            ? "pointer"
                                            : "not-allowed",
                                        }}
                                      >
                                        Void rating
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setVoidingRatingId(null);
                                          setVoidErrors((prev) => {
                                            const next = { ...prev };
                                            delete next[rating.id];
                                            return next;
                                          });
                                        }}
                                        className="text-xs underline min-h-[44px] px-1 text-text-secondary"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
