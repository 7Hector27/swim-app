"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CoachSwimmerDetail,
  EvaluationDraft,
  GetSessionResponse,
  ScreensResponse,
  SkillForRating,
  SwimmerSkillsResponse,
} from "@swim-app/shared";
import { calculateBilateralBreathingGrade } from "@swim-app/shared";
import AddNoteForm from "@/components/AddNoteForm";
import { deleteDraft, fetchDependencyMapAction, fetchServerDraftsAction, patchSessionAction, saveDraft, submitEvaluation } from "./actions";
import type { EvaluateFieldIssue, EvaluateState, SessionDraft, SkillDraft } from "./helpers";
import {
  defaultSkillDraft,
  initialSessionDraft,
  todayLA,
  buildRatingKeys,
  buildRatingsArray,
  buildSectionGroups,
  validateSubmission,
  sortIssuesForScroll,
  anchorIdForIssue,
  DOM_IDS,
} from "./helpers";
import { SCREEN_SECTIONS } from "./screenSections";
import SessionSetup from "./SessionSetup";
import CoachingPriorityField from "./CoachingPriorityField";
import StartGroupSection from "./StartGroupSection";
import SkillGradeRow from "./SkillGradeRow";
import SideRatedRowPair from "./SideRatedRowPair";
import CalculatedSkillRow from "./CalculatedSkillRow";
import SectionTabs from "./SectionTabs";
import UndoToast from "./UndoToast";

interface EvaluateContentProps {
  swimmer: CoachSwimmerDetail;
  screens: ScreensResponse;
  prevGrades: SwimmerSkillsResponse["grades"];
  resumeDraft?: EvaluationDraft;
  // ADR 032: when present, the page runs in edit mode. The session's state
  // pre-fills the form; drafts and the server-draft banner are suppressed;
  // the submit button says "Save changes" and POSTs to PATCH.
  editSession?: GetSessionResponse;
  // Sanitized return URL used after a successful save in edit mode. The
  // route always passes one through `isSafeReturnTo`; this is optional only
  // so existing unit tests don't have to pass it. Falls back to the swimmer
  // page.
  returnTo?: string;
}

export default function EvaluateContent({
  swimmer,
  screens,
  prevGrades,
  resumeDraft,
  editSession,
  returnTo,
}: EvaluateContentProps) {
  const isEditMode = editSession !== undefined;
  const effectiveReturnTo = returnTo ?? `/coach/swimmers/${swimmer.id}`;
  const metaKey = useMemo(() => `evaluate-draft-meta-${swimmer.id}`, [swimmer.id]);
  const skillsKey = useCallback((slug: string) => `evaluate-draft-skills-${swimmer.id}-${slug}`, [swimmer.id]);

  const [draft, setDraft] = useState<SessionDraft>(() => {
    // ADR 032: edit mode pre-fills from the fetched session. Key format
    // matches the create flow: `${skillId}` for non-sided, `${skillId}:left`
    // or `${skillId}:right` for sided ratings. ratingId is tracked separately
    // (see editRatingIdByKeyRef below) so the PATCH body can address each
    // rating by its id.
    if (editSession) {
      const skills: Record<string, SkillDraft> = {};
      for (const rating of editSession.ratings) {
        const key = rating.side !== null ? `${rating.skillId}:${rating.side}` : rating.skillId;
        skills[key] = {
          grade: rating.grade as 1 | 2 | 3 | 4 | 5 | null,
          notLegal: rating.notLegal,
          noConcept: rating.noConcept,
          capacityValue: rating.capacityValue ?? "",
          capacityUnit: rating.capacityUnit,
          measurementValue: rating.measurementValue ?? "",
          measurementUnit: rating.measurementUnit,
          note: rating.note ?? "",
          faultTags: rating.faultTags,
          detailsOpen: false,
          golfScoreCategory: rating.golfScoreCategory,
        };
      }
      return {
        screenSlug: editSession.screenSlug,
        sessionDate: editSession.sessionDate,
        context: editSession.context,
        coachingPriority: editSession.coachingPriority ?? "",
        breathingPattern: editSession.breathingPattern,
        skills,
      };
    }
    if (resumeDraft) {
      const skills: Record<string, SkillDraft> = {};
      for (const [key, entry] of Object.entries(resumeDraft.payload)) {
        skills[key] = {
          grade: entry.grade,
          notLegal: entry.notLegal,
          noConcept: entry.noConcept,
          capacityValue: entry.capacityValue,
          capacityUnit: entry.capacityUnit,
          measurementValue: entry.measurementValue,
          measurementUnit: entry.measurementUnit,
          note: entry.note,
          faultTags: entry.faultTags,
          detailsOpen: false,
          golfScoreCategory: entry.golfScoreCategory,
        };
      }
      return {
        screenSlug: resumeDraft.screenSlug,
        sessionDate: resumeDraft.sessionDate ?? todayLA(),
        context: resumeDraft.context,
        coachingPriority: resumeDraft.coachingPriority ?? "",
        breathingPattern: resumeDraft.breathingPattern,
        skills,
      };
    }
    return initialSessionDraft();
  });

  // In edit mode, map draft keys back to the live ratingIds for the PATCH
  // body. Refreshed when the 409 banner triggers a re-fetch.
  const editRatingIdByKeyRef = useRef<Map<string, string>>(
    new Map(
      editSession?.ratings.map((rating) => [
        rating.side !== null ? `${rating.skillId}:${rating.side}` : rating.skillId,
        rating.ratingId,
      ]) ?? [],
    ),
  );
  // "This evaluation was edited elsewhere" banner on 409.
  const [staleBanner, setStaleBanner] = useState(false);
  const [skillSearch, setSkillSearch] = useState("");
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const [depSuggestion, setDepSuggestion] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "loaded"; chain: Array<{ slug: string; grade: unknown; sortOrder: number }> | null }
    | { status: "error" }
  >({ status: "idle" });
  const mountedRef = useRef(false);
  const savedAtRef = useRef<number>(0);
  const savedScreenSlugRef = useRef<string>("");
  const [serverDraftId, setServerDraftId] = useState<string | null>(resumeDraft?.id ?? null);
  const [draftSaveState, setDraftSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Server draft detection
  const [serverDraftsBySlug, setServerDraftsBySlug] = useState<Map<string, import("@swim-app/shared").EvaluationDraft>>(new Map());
  const [bannerDraft, setBannerDraft] = useState<import("@swim-app/shared").EvaluationDraft | null>(null);
  const [showBannerConfirm, setShowBannerConfirm] = useState(false);
  const serverDraftsFetchedRef = useRef(false);
  // Debounced server save
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftChangedRef = useRef(false);
  const isFirstDraftRenderRef = useRef(true);
  // Always-current draft ref for save-on-hide
  const pendingDraftRef = useRef(draft);

  // Restore draft from localStorage on mount (skip when a resumeDraft was
  // provided, and skip entirely in edit mode — ADR 032 says edit mode is a
  // one-shot form that doesn't touch the draft).
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (resumeDraft) return;
    if (isEditMode) return;
    try {
      const meta = JSON.parse(localStorage.getItem(metaKey) ?? "null");
      if (meta && typeof meta === "object") {
        const { screenSlug, sessionDate, context, coachingPriority, breathingPattern } = meta as Partial<SessionDraft>;
        const storedScreenSlug = typeof screenSlug === "string" ? screenSlug : "";
        let skills: Record<string, SkillDraft> = {};
        if (storedScreenSlug) {
          const skillsStored = JSON.parse(localStorage.getItem(skillsKey(storedScreenSlug)) ?? "null");
          if (skillsStored && typeof skillsStored === "object" && "skills" in skillsStored) {
            skills = skillsStored.skills as Record<string, SkillDraft>;
          }
        }
        setDraft({
          screenSlug: storedScreenSlug,
          sessionDate: typeof sessionDate === "string" ? sessionDate : todayLA(),
          context: context === "drill" || context === "practice" || context === "race" ? context : null,
          coachingPriority: typeof coachingPriority === "string" ? coachingPriority : "",
          breathingPattern:
            breathingPattern === "every_1" || breathingPattern === "every_2" ||
            breathingPattern === "every_3" || breathingPattern === "every_4" ||
            breathingPattern === "every_5" || breathingPattern === "other"
              ? breathingPattern
              : null,
          skills,
        });
      }
    } catch {
      // ignore
    }
  }, [swimmer.id, metaKey, skillsKey, resumeDraft, isEditMode]);

  // Deep link: ?skill=<slug> on arrival from the progress page's "What to work
  // on next" list. Scrolls to the matching skill and opens its section tab.
  // Picks a screen when none is set yet; never clobbers an in-progress draft
  // on a different screen (silent fallback — the coach can switch manually).
  //
  // Declared BEFORE the save-to-localStorage effect so it reads the pristine
  // stored value before `save` overwrites it with the initial empty draft on
  // the first commit.
  const deepLinkConsumedRef = useRef(false);
  const deepLinkSlugRef = useRef<string | null>(
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("skill")
      : null,
  );
  useEffect(() => {
    if (deepLinkConsumedRef.current) return;
    const slug = deepLinkSlugRef.current;
    if (slug === null) {
      deepLinkConsumedRef.current = true;
      return;
    }
    const currentScreen = screens.find((screen) => screen.screenSlug === draft.screenSlug);
    const currentSkill = currentScreen?.skills.find((skill) => skill.slug === slug) ?? null;
    if (currentSkill !== null && currentScreen !== undefined) {
      const sections = SCREEN_SECTIONS[currentScreen.screenSlug] ?? [];
      const sectionIndex = sections.findIndex((section) => section.slugs.includes(slug));
      if (sectionIndex >= 0) setActiveSectionIndex(sectionIndex);
      const skillId = currentSkill.id;
      requestAnimationFrame(() => {
        document
          .getElementById(`skill-${skillId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      deepLinkConsumedRef.current = true;
      deepLinkSlugRef.current = null;
      return;
    }
    if (draft.screenSlug === "") {
      // The restore effect fires on the same commit as this one and updates
      // draft asynchronously, so draft.screenSlug can still read "" even
      // when a stored draft exists. Peek at localStorage directly.
      //
      //   - stored screen already contains the target: wait (don't mark
      //     consumed). When restore flushes, the effect re-runs with
      //     currentScreen set and the top branch does the scroll.
      //   - stored screen is set to something else: honor the in-progress
      //     draft, don't switch screens, don't scroll.
      //   - nothing stored: pick the first screen containing the target.
      let storedScreenSlug: string | null = null;
      try {
        const metaRaw = localStorage.getItem(metaKey);
        if (metaRaw) {
          const meta = JSON.parse(metaRaw) as { screenSlug?: string };
          storedScreenSlug = typeof meta.screenSlug === "string" ? meta.screenSlug : null;
        }
      } catch {
        // ignore
      }
      if (storedScreenSlug && storedScreenSlug !== "") {
        const storedScreen = screens.find((screen) => screen.screenSlug === storedScreenSlug);
        const storedHasSlug = storedScreen?.skills.some((skill) => skill.slug === slug) ?? false;
        if (storedHasSlug) {
          // Wait for restore to flush; the effect re-runs with the new
          // draft.screenSlug and the top branch takes over.
          return;
        }
        deepLinkConsumedRef.current = true;
        deepLinkSlugRef.current = null;
        return;
      }
      const matching = screens.find((screen) =>
        screen.skills.some((skill) => skill.slug === slug),
      );
      if (matching) {
        handleScreenChange(matching.screenSlug);
      } else {
        deepLinkConsumedRef.current = true;
        deepLinkSlugRef.current = null;
      }
      return;
    }
    deepLinkConsumedRef.current = true;
    deepLinkSlugRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screens, draft.screenSlug]);

  // Persist draft to localStorage on every change. Suppressed in edit mode
  // — ADR 032 says edit mode never writes draft state locally.
  useEffect(() => {
    if (isEditMode) return;
    try {
      localStorage.setItem(metaKey, JSON.stringify({
        screenSlug: draft.screenSlug,
        sessionDate: draft.sessionDate,
        context: draft.context,
        coachingPriority: draft.coachingPriority,
        breathingPattern: draft.breathingPattern,
      }));
      if (draft.screenSlug) {
        localStorage.setItem(skillsKey(draft.screenSlug), JSON.stringify({ skills: draft.skills }));
      }
    } catch {
      // ignore
    }
  }, [draft, swimmer.id, metaKey, skillsKey, isEditMode]);

  // Fetch dep suggestion when screenSlug changes
  useEffect(() => {
    if (!draft.screenSlug) {
      setDepSuggestion({ status: "idle" });
      return;
    }
    setDepSuggestion({ status: "loading" });
    fetchDependencyMapAction(swimmer.id, draft.screenSlug)
      .then((result) => {
        if (!result.ok) {
          setDepSuggestion({ status: "error" });
        } else {
          setDepSuggestion({ status: "loaded", chain: result.chain });
        }
      })
      .catch(() => {
        setDepSuggestion({ status: "error" });
      });
  }, [draft.screenSlug, swimmer.id]);

  // ADR 032: in edit mode the form action is the PATCH wrapper, bound to
  // the target session id and the sanitized returnTo. In create mode it's
  // the existing submitEvaluation action.
  const boundAction = useMemo(
    () =>
      isEditMode
        ? patchSessionAction.bind(null, editSession!.sessionId, effectiveReturnTo)
        : submitEvaluation.bind(null, swimmer.id),
    [isEditMode, editSession, effectiveReturnTo, swimmer.id],
  );
  const [state, formAction, isPending] = useActionState<EvaluateState, FormData>(
    boundAction,
    { status: "idle" },
  );

  // Capture savedAt, clear localStorage, and clean up server draft on success.
  useEffect(() => {
    if (state.status === "saved") {
      savedAtRef.current = Date.now();
      try {
        localStorage.removeItem(metaKey);
        const slug = savedScreenSlugRef.current;
        if (slug) {
          localStorage.removeItem(skillsKey(slug));
        }
      } catch {
        // ignore
      }
      if (serverDraftId) {
        deleteDraft(serverDraftId).catch(() => null);
      }
    }
  // serverDraftId intentionally excluded — we only want to delete once on the saved event
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, metaKey, skillsKey]);

  // ADR 032: on a 409 from PATCH, show the banner and let the coach decide
  // whether to review and resubmit. The server already refuses the save, so
  // nothing of theirs is lost; keeping local edits around means they can
  // adjust and retry without re-entering everything. If they want a fresh
  // read of the server state, they can navigate away and back.
  useEffect(() => {
    if (state.status === "stale") setStaleBanner(true);
  }, [state.status]);

  // Keep pendingDraftRef in sync with latest draft
  useEffect(() => {
    pendingDraftRef.current = draft;
  }, [draft]);

  // Fetch server drafts once on mount. Skipped in edit mode (no draft list
  // to merge with).
  useEffect(() => {
    if (serverDraftsFetchedRef.current) return;
    serverDraftsFetchedRef.current = true;
    if (isEditMode) return;
    fetchServerDraftsAction(swimmer.id)
      .then((drafts) => {
        const map = new Map<string, import("@swim-app/shared").EvaluationDraft>();
        for (const serverDraft of drafts) {
          map.set(serverDraft.screenSlug, serverDraft);
        }
        setServerDraftsBySlug(map);
      })
      .catch(() => null);
  }, [swimmer.id, isEditMode]);

  // Show banner when current screen has a server draft (not already loaded).
  // Suppressed in edit mode.
  useEffect(() => {
    if (isEditMode) return;
    if (!draft.screenSlug || serverDraftsBySlug.size === 0) return;
    const found = serverDraftsBySlug.get(draft.screenSlug);
    if (found && found.id !== serverDraftId) {
      setBannerDraft(found);
    } else {
      setBannerDraft(null);
      setShowBannerConfirm(false);
    }
    // serverDraftId intentionally omitted — only re-evaluate when slug or server list changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.screenSlug, serverDraftsBySlug, isEditMode]);

  // Debounced server autosave — fires ~20s after last draft change. Skipped
  // in edit mode (no server draft row to update).
  useEffect(() => {
    if (isFirstDraftRenderRef.current) {
      isFirstDraftRenderRef.current = false;
      return;
    }
    if (isEditMode) return;
    if (!draft.screenSlug) return;
    draftChangedRef.current = true;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      void saveDraftNow(pendingDraftRef.current);
    }, 20_000);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save on page hide (tab close, navigate away) — clears debounce timer.
  // Suppressed in edit mode.
  useEffect(() => {
    if (isEditMode) return;
    function onHide() {
      if (!pendingDraftRef.current.screenSlug || !draftChangedRef.current) return;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      void saveDraftNow(pendingDraftRef.current);
    }
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [isEditMode]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveDraftNow(draftToSave: SessionDraft): Promise<void> {
    if (!draftToSave.screenSlug) return;
    setDraftSaveState("saving");
    const payload: Record<string, import("@swim-app/shared").DraftSkillPayload> = {};
    for (const [key, skillDraft] of Object.entries(draftToSave.skills)) {
      payload[key] = {
        grade: skillDraft.grade,
        notLegal: skillDraft.notLegal,
        noConcept: skillDraft.noConcept,
        faultTags: skillDraft.faultTags,
        capacityValue: skillDraft.capacityValue,
        capacityUnit: skillDraft.capacityUnit,
        measurementValue: skillDraft.measurementValue,
        measurementUnit: skillDraft.measurementUnit,
        golfScoreCategory: skillDraft.golfScoreCategory,
        note: skillDraft.note,
      };
    }
    const result = await saveDraft(swimmer.id, draftToSave.screenSlug, {
      sessionDate: draftToSave.sessionDate || null,
      context: draftToSave.context,
      coachingPriority: draftToSave.coachingPriority || null,
      breathingPattern: draftToSave.breathingPattern,
      payload,
    });
    if (result.status === "saved") {
      setServerDraftId(result.id);
      setDraftSaveState("saved");
      draftChangedRef.current = false;
    } else {
      setDraftSaveState("error");
    }
  }

  function handleSaveDraft(): void {
    void saveDraftNow(pendingDraftRef.current);
  }

  function handleScreenChange(newScreenSlug: string) {
    let skills: Record<string, SkillDraft> = {};
    try {
      const stored = JSON.parse(localStorage.getItem(skillsKey(newScreenSlug)) ?? "null");
      if (stored && typeof stored === "object" && "skills" in stored) {
        skills = stored.skills as Record<string, SkillDraft>;
      }
    } catch { /* ignore */ }
    const needsBreathing = newScreenSlug === "freestyle" || newScreenSlug === "butterfly";
    setDraft((prev) => ({
      ...prev,
      screenSlug: newScreenSlug,
      breathingPattern: needsBreathing ? prev.breathingPattern : null,
      skills,
    }));
    // Reset to the first section whenever the screen changes so the coach
    // isn't dropped into an unrelated section index from the previous screen.
    setActiveSectionIndex(0);
  }

  function handleResumeBannerDraft() {
    if (!bannerDraft) return;
    const skills: Record<string, SkillDraft> = {};
    for (const [key, entry] of Object.entries(bannerDraft.payload)) {
      skills[key] = {
        grade: entry.grade,
        notLegal: entry.notLegal,
        noConcept: entry.noConcept,
        capacityValue: entry.capacityValue,
        capacityUnit: entry.capacityUnit,
        measurementValue: entry.measurementValue,
        measurementUnit: entry.measurementUnit,
        note: entry.note,
        faultTags: entry.faultTags,
        detailsOpen: false,
        golfScoreCategory: entry.golfScoreCategory,
      };
    }
    setDraft({
      screenSlug: bannerDraft.screenSlug,
      sessionDate: bannerDraft.sessionDate ?? todayLA(),
      context: bannerDraft.context,
      coachingPriority: bannerDraft.coachingPriority ?? "",
      breathingPattern: bannerDraft.breathingPattern,
      skills,
    });
    setServerDraftId(bannerDraft.id);
    setBannerDraft(null);
    setShowBannerConfirm(false);
    setActiveSectionIndex(0);
  }

  function handleStartFreshConfirmed() {
    if (!bannerDraft) return;
    void Promise.resolve(deleteDraft(bannerDraft.id)).catch(() => null);
    setBannerDraft(null);
    setShowBannerConfirm(false);
  }

  function patchSkill(key: string, patch: Partial<SkillDraft>) {
    setDraft((prev) => ({
      ...prev,
      skills: {
        ...prev.skills,
        [key]: { ...(prev.skills[key] ?? defaultSkillDraft()), ...patch },
      },
    }));
  }

  const selectedScreen = screens.find((screen) => screen.screenSlug === draft.screenSlug) ?? null;

  const slugToName = Object.fromEntries(
    screens.flatMap((screen) => screen.skills.map((skill) => [skill.slug, skill.name])),
  );

  const ratingsArray = useMemo(
    () => (selectedScreen ? buildRatingsArray(selectedScreen.skills, draft.skills) : []),
    [selectedScreen, draft.skills],
  );
  const ratingKeys = useMemo(
    () => (selectedScreen ? buildRatingKeys(selectedScreen.skills, draft.skills) : []),
    [selectedScreen, draft.skills],
  );
  const submitEnabled = !isPending;

  const [clientIssues, setClientIssues] = useState<EvaluateFieldIssue[]>([]);
  const [tapNonce, setTapNonce] = useState(0);
  const [serverIssueNonce, setServerIssueNonce] = useState(0);

  const serverIssues: EvaluateFieldIssue[] = useMemo(
    () => (state.status === "error" && state.issues ? state.issues : []),
    [state],
  );

  useEffect(() => {
    if (state.status === "error" && serverIssues.length > 0) {
      setServerIssueNonce((prev) => prev + 1);
    }
  }, [state, serverIssues.length]);

  const activeIssues = clientIssues.length > 0 ? clientIssues : serverIssues;

  const issuesByDraftKey = useMemo(() => {
    const map = new Map<string, EvaluateFieldIssue[]>();
    for (const issue of activeIssues) {
      if (issue.ratingIndex === undefined) continue;
      const key = ratingKeys[issue.ratingIndex];
      if (key === undefined) continue;
      const list = map.get(key) ?? [];
      list.push(issue);
      map.set(key, list);
    }
    return map;
  }, [activeIssues, ratingKeys]);
  const sessionLevelIssues = useMemo(
    () => activeIssues.filter((issue) => issue.ratingIndex === undefined),
    [activeIssues],
  );
  const coachingPriorityIssue = sessionLevelIssues.find((issue) => issue.field === "coachingPriority");
  const sessionSetupIssues = useMemo(
    () => sessionLevelIssues.filter((issue) => issue.field !== "coachingPriority" && issue.field !== "ratings"),
    [sessionLevelIssues],
  );
  const ratingsIssue = sessionLevelIssues.find((issue) => issue.field === "ratings");

  const screenSections = selectedScreen !== null
    ? (SCREEN_SECTIONS[selectedScreen.screenSlug] ?? null)
    : null;

  const sectionGroups = selectedScreen !== null && screenSections !== null
    ? buildSectionGroups(selectedScreen, screenSections)
    : null;

  // Which section does a given rating-key (`${skillId}` or `${skillId}:side`)
  // belong to? Used to switch to the right tab before scrolling to the issue.
  const sectionIndexForSkillId = useMemo(() => {
    if (sectionGroups === null) return (): number | null => null;
    const map = new Map<string, number>();
    sectionGroups.forEach((section, index) => {
      for (const skill of section.skills) {
        map.set(skill.id, index);
      }
    });
    return (skillId: string): number | null => map.get(skillId) ?? null;
  }, [sectionGroups]);

  // Per-section rated / total counts for the tab chips.
  const sectionCounts = useMemo(() => {
    if (sectionGroups === null) return [] as Array<{ name: string; count: number; completed: number }>;
    return sectionGroups.map((section) => {
      let completed = 0;
      const ratable = section.skills.filter((skill) => skill.type !== "rollup");
      for (const skill of ratable) {
        const keys = skill.ratedPerSide
          ? [`${skill.id}:left`, `${skill.id}:right`]
          : [skill.id];
        if (keys.some((key) => {
          const skillDraft = draft.skills[key];
          if (!skillDraft) return false;
          return (
            skillDraft.grade !== null ||
            skillDraft.noConcept ||
            skillDraft.notLegal ||
            skillDraft.measurementValue !== ""
          );
        })) {
          completed += 1;
        }
      }
      return { name: section.name, count: ratable.length, completed };
    });
  }, [sectionGroups, draft.skills]);

  // Scroll to and focus the first invalid field whenever the coach taps Save
  // with issues, OR whenever a new server 422 arrives. If the issue lives in
  // a non-active section, switch the tab first (via rAF) so the DOM anchor
  // exists on the second frame. Session-level issues scroll synchronously —
  // their anchors are always mounted.
  useEffect(() => {
    if (activeIssues.length === 0) return;
    if (tapNonce === 0 && serverIssueNonce === 0) return;
    const sorted = sortIssuesForScroll(activeIssues);
    const first = sorted[0];
    if (!first) return;
    const anchor = anchorIdForIssue(first, ratingKeys);
    if (!anchor) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function doScroll() {
      const el = document.getElementById(anchor!);
      if (!el) return;
      el.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "center",
      });
      const focusTarget = el.querySelector<HTMLElement>(
        "input:not([type='hidden']), select, textarea, [role='group'] button, button[type='button']",
      );
      focusTarget?.focus({ preventScroll: true });
    }

    // Per-skill issue: switch to the section that owns the skill (if we're
    // not already there) and wait a frame so the anchor is mounted before
    // scrolling. Otherwise, scroll synchronously.
    let needsSectionSwitch = false;
    if (first.ratingIndex !== undefined) {
      const key = ratingKeys[first.ratingIndex];
      if (key !== undefined) {
        const skillId = key.split(":")[0] ?? key;
        const index = sectionIndexForSkillId(skillId);
        if (index !== null && index !== activeSectionIndex) {
          setActiveSectionIndex(index);
          needsSectionSwitch = true;
        }
      }
    }

    if (needsSectionSwitch) {
      requestAnimationFrame(doScroll);
    } else {
      doScroll();
    }
    // Intentional: nonces drive this effect; activeIssues identity isn't a
    // dependency so re-renders without a new tap don't re-scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tapNonce, serverIssueNonce]);

  function handleFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    savedScreenSlugRef.current = draft.screenSlug;
    setTapNonce((prev) => prev + 1);
    const issues = validateSubmission(draft, ratingsArray);
    if (issues.length > 0) {
      event.preventDefault();
      setClientIssues(issues);
      return;
    }
    setClientIssues([]);
  }

  // Empty / whitespace-only priority goes over the wire as null so the API
  // writes NULL to the DB rather than hitting the `<> ''` check constraint.
  const trimmedPriority = draft.coachingPriority.trim();
  const bodyJson = isEditMode
    ? JSON.stringify({
        sessionDate: draft.sessionDate,
        context: draft.context,
        coachingPriority: trimmedPriority.length > 0 ? trimmedPriority : null,
        breathingPattern: draft.breathingPattern,
        // PATCH body expects per-rating objects keyed by ratingId. Every
        // draft row that maps to a live ratingId is forwarded. Rows the
        // coach has not touched produce no-op diffs on the server.
        ratings: ratingsArray.flatMap((rating) => {
          const key =
            rating.side !== null ? `${rating.skillId}:${rating.side}` : rating.skillId;
          const ratingId = editRatingIdByKeyRef.current.get(key);
          if (!ratingId) return [];
          return [
            {
              ratingId,
              grade: rating.grade,
              notLegal: rating.notLegal,
              noConcept: rating.noConcept,
              side: rating.side,
              capacityValue: rating.capacityValue,
              capacityUnit: rating.capacityUnit,
              measurementValue: rating.measurementValue,
              measurementUnit: rating.measurementUnit,
              golfScoreCategory: rating.golfScoreCategory,
              note: rating.note,
              faultTags: rating.faultTags,
            },
          ];
        }),
      })
    : JSON.stringify({
        screenSlug: draft.screenSlug,
        sessionDate: draft.sessionDate,
        context: draft.context,
        coachingPriority: trimmedPriority.length > 0 ? trimmedPriority : null,
        breathingPattern: draft.breathingPattern,
        ratings: ratingsArray,
      });

  const searchResults = useMemo(() => {
    if (!skillSearch.trim() || !sectionGroups) return [];
    const query = skillSearch.toLowerCase();
    const seen = new Set<string>();
    const results: Array<{ skill: SkillForRating; sectionIndex: number; sectionName: string }> = [];
    sectionGroups.forEach((section, index) => {
      for (const skill of section.skills) {
        if (skill.type === "rollup") continue;
        if (skill.name.toLowerCase().includes(query) && !seen.has(skill.id)) {
          results.push({ skill, sectionIndex: index, sectionName: section.name });
          seen.add(skill.id);
        }
      }
    });
    return results.slice(0, 8);
  }, [skillSearch, sectionGroups]);

  function jumpToSkill(skill: SkillForRating, sectionIndex: number) {
    setActiveSectionIndex(sectionIndex);
    setSkillSearch("");
    requestAnimationFrame(() => {
      document.getElementById(`skill-${skill.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function renderSkill(skill: SkillForRating, screen: typeof screens[number]) {
    const label = skill.name;
    if (skill.type === "rollup") {
      let calculatedGrade: 1 | 2 | 3 | 4 | 5 | null = null;
      if (skill.slug === "free-bilateral-breathing") {
        const breathingSkill = screen.skills.find((s) => s.slug === "breathing-timing-free");
        if (breathingSkill) {
          const leftGrade = draft.skills[`${breathingSkill.id}:left`]?.grade ?? null;
          const rightGrade = draft.skills[`${breathingSkill.id}:right`]?.grade ?? null;
          calculatedGrade = calculateBilateralBreathingGrade(leftGrade, rightGrade);
        }
      }
      const prev = prevGrades[skill.slug];
      return (
        <CalculatedSkillRow
          key={skill.id}
          skill={skill}
          label={label}
          calculatedGrade={calculatedGrade}
          {...(prev !== undefined && { prevGrade: prev })}
        />
      );
    }
    if (skill.ratedPerSide) {
      const leftIssues = issuesByDraftKey.get(`${skill.id}:left`);
      const rightIssues = issuesByDraftKey.get(`${skill.id}:right`);
      const prevLeft = prevGrades[`${skill.slug}:left`];
      const prevRight = prevGrades[`${skill.slug}:right`];
      return (
        <SideRatedRowPair
          key={skill.id}
          skill={skill}
          label={label}
          leftDraft={draft.skills[`${skill.id}:left`] ?? defaultSkillDraft()}
          rightDraft={draft.skills[`${skill.id}:right`] ?? defaultSkillDraft()}
          onChange={patchSkill}
          {...(leftIssues !== undefined && { leftIssues })}
          {...(rightIssues !== undefined && { rightIssues })}
          {...(prevLeft !== undefined && { prevGradeLeft: prevLeft })}
          {...(prevRight !== undefined && { prevGradeRight: prevRight })}
        />
      );
    }
    const rowIssues = issuesByDraftKey.get(skill.id);
    const prev = prevGrades[skill.slug];
    return (
      <SkillGradeRow
        key={skill.id}
        skill={skill}
        draftKey={skill.id}
        label={label}
        draft={draft.skills[skill.id] ?? defaultSkillDraft()}
        onChange={patchSkill}
        {...(rowIssues !== undefined && { issues: rowIssues })}
        {...(prev !== undefined && { prevGrade: prev })}
      />
    );
  }

  // ── Success screen ────────────────────────────────────────────────────────────

  if (state.status === "saved") {
    return (
      <div className="flex flex-col flex-1">
        <main className="flex-1 px-page py-8">
          <div className="mx-auto max-w-content flex flex-col gap-6">
            <h1 className="text-heading" style={{ color: "var(--color-text)" }}>
              Evaluation saved for {swimmer.firstName}
            </h1>

            {/* UndoToast only applies to brand-new evaluations. ADR 032 edit
                mode preserves the pre-correction row via the supersede chain,
                so an undo-via-delete would never be the right action here. */}
            {!isEditMode && (
              <UndoToast
                swimmer={swimmer}
                sessionId={state.sessionId}
                savedAt={savedAtRef.current}
              />
            )}

            <section className="flex flex-col gap-3">
              <h2 className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
                Add a session note
              </h2>
              <AddNoteForm
                swimmerId={swimmer.id}
                sessionId={state.sessionId}
              />
            </section>

            <a
              href={`/coach/swimmers/${swimmer.id}`}
              className="text-sm underline"
              style={{ color: "var(--color-link)" }}
            >
              ← Back to {swimmer.firstName}
            </a>
          </div>
        </main>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────────

  const activeSection = sectionGroups?.[activeSectionIndex] ?? null;
  const startParentIds = selectedScreen
    ? new Set(
        selectedScreen.skills
          .filter(
            (skill) =>
              skill.parentSkillId === null &&
              selectedScreen.skills.some((other) => other.parentSkillId === skill.id),
          )
          .map((skill) => skill.id),
      )
    : new Set<string>();

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <main className="flex-1 px-page pt-6 pb-28">
        <div className="mx-auto max-w-content flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <a
              href={`/coach/swimmers/${swimmer.id}`}
              className="text-sm underline"
              style={{ color: "var(--color-link)" }}
            >
              ← {swimmer.firstName} {swimmer.lastName}
            </a>
            <h1 className="text-heading" style={{ color: "var(--color-text)" }}>
              Evaluate {swimmer.firstName}
            </h1>
          </div>

          {activeIssues.length > 0 && (
            <div
              role="alert"
              aria-live="polite"
              data-testid="evaluate-issues-summary"
              className="flex flex-col gap-1 text-sm"
              style={{ color: "var(--color-danger)" }}
            >
              <p className="font-semibold">
                {activeIssues.length} {activeIssues.length === 1 ? "thing needs" : "things need"} attention
              </p>
              {sessionLevelIssues.length > 0 && (
                <ul className="list-disc pl-5">
                  {sessionLevelIssues.map((issue, index) => (
                    <li key={`${issue.field}-${index}`} data-testid={`session-issue-${issue.field}`}>
                      {issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {state.status === "error" && activeIssues.length === 0 && (
            <p role="alert" className="text-sm" style={{ color: "var(--color-danger)" }}>
              {state.message}
            </p>
          )}

          {staleBanner && (
            <div
              role="alert"
              className="p-3 rounded border text-sm"
              style={{
                borderColor: "var(--color-danger)",
                color: "var(--color-text)",
                backgroundColor: "var(--color-background)",
              }}
              data-testid="evaluate-stale-banner"
            >
              This evaluation was edited elsewhere. Review and save again.
            </div>
          )}

          {!isEditMode && bannerDraft !== null && (
            <div
              role="alert"
              className="flex flex-col gap-2 p-3 rounded border border-border text-sm text-text"
            >
              <div className="flex items-center justify-between gap-3">
                <span>
                  You have a saved draft from {new Date(bannerDraft.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" })}. Resume it?
                </span>
                <div className="flex gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={handleResumeBannerDraft}
                    className="font-semibold underline text-link min-h-[44px] px-1"
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowBannerConfirm(true)}
                    className="underline text-text-secondary min-h-[44px] px-1"
                  >
                    Start fresh
                  </button>
                </div>
              </div>
              {showBannerConfirm && (
                <div className="flex items-center justify-between gap-3 pt-1 border-t border-border">
                  <span className="text-text-secondary">Delete this draft and start fresh?</span>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleStartFreshConfirmed}
                      className="font-semibold text-danger underline min-h-[44px] px-1"
                    >
                      Delete draft
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowBannerConfirm(false)}
                      className="underline text-text-secondary min-h-[44px] px-1"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <form
            action={formAction}
            noValidate
            className="flex flex-col gap-6"
            onSubmit={handleFormSubmit}
          >
            <input type="hidden" name="bodyJson" value={bodyJson} />

            <SessionSetup
              draft={draft}
              screens={screens}
              onScreenChange={handleScreenChange}
              onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
              issues={sessionSetupIssues}
              {...(isEditMode && selectedScreen !== null && {
                screenLockedName: selectedScreen.name,
              })}
            />

            {/* Skills — card grid under sticky section tabs */}
            {selectedScreen !== null && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h2 className="font-bold text-sm" style={{ color: "var(--color-text)" }}>
                    Skills · {selectedScreen.name}
                  </h2>
                </div>

                <div className="relative">
                  <input
                    type="search"
                    placeholder="Search skills…"
                    value={skillSearch}
                    onChange={(event) => setSkillSearch(event.target.value)}
                    className="w-full border border-border rounded px-3 py-2 text-sm min-h-[44px] text-text"
                    style={{ backgroundColor: "transparent" }}
                  />
                  {searchResults.length > 0 && (
                    <ul
                      className="absolute z-10 w-full mt-1 rounded border border-border overflow-auto bg-background"
                      style={{ maxHeight: "240px" }}
                    >
                      {searchResults.map(({ skill, sectionIndex, sectionName }) => (
                        <li key={`${skill.id}:${sectionIndex}`}>
                          <button
                            type="button"
                            onClick={() => jumpToSkill(skill, sectionIndex)}
                            className="w-full text-left px-3 py-2 text-sm text-text"
                          >
                            {skill.name}
                            <span className="ml-2 text-xs text-text-secondary">
                              {sectionName}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {sectionGroups !== null && activeSection !== null ? (
                  <>
                    <SectionTabs
                      sections={sectionCounts}
                      activeIndex={activeSectionIndex}
                      onSelect={setActiveSectionIndex}
                    />
                    <section
                      id={DOM_IDS.ratings}
                      aria-label={`${activeSection.name} skills`}
                      className="grid grid-cols-1 tablet:grid-cols-2 gap-4"
                    >
                      {activeSection.skills.map((skill) => {
                        if (startParentIds.has(skill.id)) {
                          const components = selectedScreen.skills.filter(
                            (other) => other.parentSkillId === skill.id,
                          );
                          return (
                            <div key={skill.id} className="tablet:col-span-2">
                              <StartGroupSection
                                parent={skill}
                                components={components}
                                draftSkills={draft.skills}
                                onChange={patchSkill}
                                prevGrades={prevGrades}
                              />
                            </div>
                          );
                        }
                        return renderSkill(skill, selectedScreen);
                      })}
                    </section>
                  </>
                ) : (
                  // Fallback for screens without a SCREEN_SECTIONS entry: no
                  // tabs, just a flat grid of every skill in the screen.
                  <section
                    id={DOM_IDS.ratings}
                    className="grid grid-cols-1 tablet:grid-cols-2 gap-4"
                  >
                    {selectedScreen.skills
                      .filter(
                        (skill) =>
                          !startParentIds.has(skill.id) &&
                          (skill.parentSkillId === null || !startParentIds.has(skill.parentSkillId ?? "")),
                      )
                      .map((skill) => renderSkill(skill, selectedScreen))}
                    {selectedScreen.skills
                      .filter((skill) => startParentIds.has(skill.id))
                      .map((parent) => (
                        <div key={parent.id} className="tablet:col-span-2">
                          <StartGroupSection
                            parent={parent}
                            components={selectedScreen.skills.filter(
                              (other) => other.parentSkillId === parent.id,
                            )}
                            draftSkills={draft.skills}
                            onChange={patchSkill}
                            prevGrades={prevGrades}
                          />
                        </div>
                      ))}
                  </section>
                )}
              </div>
            )}

            {ratingsIssue && (
              <p id={DOM_IDS.ratings + "-error"} className="text-xs" style={{ color: "var(--color-danger)" }}>
                {ratingsIssue.message}
              </p>
            )}

            <CoachingPriorityField
              value={draft.coachingPriority}
              onChange={(value) => setDraft((prev) => ({ ...prev, coachingPriority: value }))}
              suggestion={depSuggestion}
              slugToName={slugToName}
              {...(coachingPriorityIssue !== undefined && { issue: coachingPriorityIssue })}
            />

            {/* Sticky save bar. On phone the single column pushes the actions
                to the thumb line; on tablet they stay on the same row. The
                safe-area inset handles iOS home-indicator overlap. */}
            <div
              className="sticky bottom-0 left-0 right-0 -mx-page px-page py-3 border-t border-border bg-background flex items-center gap-3 flex-wrap"
              style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
            >
              <button
                type="submit"
                disabled={!submitEnabled}
                className="inline-flex items-center justify-center px-5 min-h-[48px] font-bold text-sm rounded-[var(--radius-button)] flex-1 tablet:flex-initial"
                style={{
                  backgroundColor: "var(--color-button-primary-background)",
                  color: "var(--color-button-primary-text)",
                  opacity: submitEnabled ? 1 : 0.5,
                  cursor: submitEnabled ? "pointer" : "not-allowed",
                }}
                data-testid="evaluate-submit-button"
              >
                {isPending ? "Saving..." : isEditMode ? "Save changes" : "Save evaluation"}
              </button>
              {!isEditMode && (
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={draft.screenSlug === "" || draftSaveState === "saving"}
                  className="inline-flex items-center justify-center px-5 min-h-[48px] font-semibold text-sm rounded-[var(--radius-button)] border border-border text-text"
                >
                  {draftSaveState === "saving" ? "Saving..." : draftSaveState === "saved" ? "Draft saved" : draftSaveState === "error" ? "Save failed" : "Save as draft"}
                </button>
              )}
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
