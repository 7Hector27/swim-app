"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { todayLA } from "@swim-app/shared";
import type {
  AvailabilityConfig,
  AvailabilityOverride,
  AvailabilityPreviewResponse,
  BlockedTime,
  CreateOverrideBody,
  CreateSeasonBody,
  ImpactWarning,
  PatchAvailabilityConfigBody,
  PatchOverrideBody,
  PatchSeasonBody,
  SeasonWithIsCurrent,
} from "@swim-app/shared";

import ConfirmDialog from "@/components/ConfirmDialog";
import { apiErrorMessage } from "@/lib/apiErrorMessage";
import {
  copyNextYearAction,
  createOverrideAction,
  createSeasonAction,
  deleteOverrideAction,
  deleteSeasonAction,
  fetchAvailabilityPreviewAction,
  fetchSeasonsAction,
  patchAvailabilityConfigAction,
  patchOverrideAction,
  patchSeasonAction,
} from "./actions";
import { addDaysIso, withIsCurrent } from "./availabilityFormat";
import { upcomingSummary } from "./seasonSummary";
import CopyToNextYearButton from "./CopyToNextYearButton";
import DefaultHoursCard from "./DefaultHoursCard";
import DefaultHoursModal from "./DefaultHoursModal";
import ImpactWarningModal from "./ImpactWarningModal";
import OverrideFormModal from "./OverrideFormModal";
import OverridesList from "./OverridesList";
import SeasonCard from "./SeasonCard";
import SeasonFormModal from "./SeasonFormModal";
import SeasonsTable from "./SeasonsTable";
import WeekPreview from "./WeekPreview";

interface Props {
  initialSeasons: SeasonWithIsCurrent[];
  initialOverrides: AvailabilityOverride[];
  initialBlockedTimes: BlockedTime[];
  initialPreview: AvailabilityPreviewResponse;
  initialWeekStart: string;
  initialConfig: AvailabilityConfig;
  today: string;
}

type PendingDeleteSeason = {
  kind: "season";
  season: SeasonWithIsCurrent;
};

type PendingDeleteOverride = {
  kind: "override";
  override: AvailabilityOverride;
};

type PendingDelete = PendingDeleteSeason | PendingDeleteOverride;

export default function CoachAvailabilityContent({
  initialSeasons,
  initialOverrides,
  initialBlockedTimes,
  initialPreview,
  initialWeekStart,
  initialConfig,
  today,
}: Props) {
  const [seasons, setSeasons] = useState(initialSeasons);
  const [overrides, setOverrides] = useState(initialOverrides);
  const [blockedTimes] = useState(initialBlockedTimes);
  const [preview, setPreview] = useState(initialPreview);
  const [weekStart, setWeekStart] = useState(initialWeekStart);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [config, setConfig] = useState(initialConfig);

  const [seasonModalOpen, setSeasonModalOpen] = useState(false);
  const [editingSeason, setEditingSeason] = useState<SeasonWithIsCurrent | null>(null);
  const [seasonPending, setSeasonPending] = useState(false);

  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [editingOverride, setEditingOverride] = useState<AvailabilityOverride | null>(null);
  const [overridePending, setOverridePending] = useState(false);

  const [defaultHoursModalOpen, setDefaultHoursModalOpen] = useState(false);
  const [defaultHoursPending, setDefaultHoursPending] = useState(false);

  const [warnings, setWarnings] = useState<ImpactWarning[]>([]);
  const [warningsOpen, setWarningsOpen] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);

  const currentSeason = useMemo(() => seasons.find((season) => season.isCurrent) ?? null, [seasons]);
  const upcomingSeasons = useMemo(
    () => seasons.filter((season) => season.startDate > today),
    [seasons, today],
  );
  const firstSeasonDate = useMemo(() => {
    const future = seasons.filter((season) => season.startDate >= today);
    if (future.length === 0) return null;
    const sorted = [...future].sort((a, b) => a.startDate.localeCompare(b.startDate));
    return sorted[0]!.startDate;
  }, [seasons, today]);
  const { nextYearLabel, cycleLabel } = useMemo(() => {
    const sorted = [...seasons].sort((a, b) => b.startDate.localeCompare(a.startDate));
    const latest = sorted[0];
    const latestYear = latest ? Number(latest.startDate.slice(0, 4)) : null;
    const nextYear = (latestYear ?? new Date().getUTCFullYear()) + 1;
    const label = latestYear ? `${latestYear - 1}–${String(latestYear).slice(2)} seasons` : "Seasons";
    return { nextYearLabel: `${nextYear}`, cycleLabel: label };
  }, [seasons]);

  async function refreshPreview(nextWeekStart: string) {
    setPreviewLoading(true);
    try {
      const response = await fetchAvailabilityPreviewAction(nextWeekStart, 7);
      setPreview(response);
    } finally {
      setPreviewLoading(false);
    }
  }

  useEffect(() => {
    if (warnings.length > 0) setWarningsOpen(true);
  }, [warnings]);

  useEffect(() => {
    const dialog = confirmDialogRef.current;
    if (!dialog) return;
    if (pendingDelete && !dialog.open) dialog.showModal();
    if (!pendingDelete && dialog.open) dialog.close();
  }, [pendingDelete]);

  async function refreshSeasons() {
    const fresh = await fetchSeasonsAction();
    if (fresh.length > 0) setSeasons(withIsCurrent(fresh, todayLA()));
  }

  function openAddSeason() {
    void refreshSeasons();
    setEditingSeason(null);
    setSeasonModalOpen(true);
  }
  function openEditSeason(season: SeasonWithIsCurrent) {
    void refreshSeasons();
    setEditingSeason(season);
    setSeasonModalOpen(true);
  }
  function openAddOverride() {
    setEditingOverride(null);
    setOverrideModalOpen(true);
  }
  function openEditOverride(override: AvailabilityOverride) {
    setEditingOverride(override);
    setOverrideModalOpen(true);
  }

  async function handleSeasonSubmit(
    body: CreateSeasonBody | PatchSeasonBody,
    mode: "create" | "patch",
  ): Promise<string | null> {
    setSeasonPending(true);
    try {
      if (mode === "create") {
        const result = await createSeasonAction(body as CreateSeasonBody);
        if (!result.ok) return apiErrorMessage(result.code, result.conflictingSeasonName);
        setSeasons((prev) => {
          const next = [...prev, result.data.season].sort((a, b) =>
            a.startDate.localeCompare(b.startDate),
          );
          return withIsCurrent(next, today);
        });
        if (result.data.warnings.length > 0) setWarnings(result.data.warnings);
        setSeasonModalOpen(false);
        await refreshPreview(weekStart);
        return null;
      }
      if (!editingSeason) return "Season no longer exists.";
      const result = await patchSeasonAction(editingSeason.id, body as PatchSeasonBody);
      if (!result.ok) return apiErrorMessage(result.code, result.conflictingSeasonName);
      setSeasons((prev) => {
        const next = prev
          .map((season) => (season.id === editingSeason.id ? result.data.season : season))
          .sort((a, b) => a.startDate.localeCompare(b.startDate));
        return withIsCurrent(next, today);
      });
      if (result.data.warnings.length > 0) setWarnings(result.data.warnings);
      setSeasonModalOpen(false);
      await refreshPreview(weekStart);
      return null;
    } finally {
      setSeasonPending(false);
    }
  }

  function requestDeleteSeason(season: SeasonWithIsCurrent) {
    setDeleteError(null);
    setPendingDelete({ kind: "season", season });
  }

  function requestDeleteOverride(override: AvailabilityOverride) {
    setDeleteError(null);
    setPendingDelete({ kind: "override", override });
  }

  function cancelDelete() {
    if (deletePending) return;
    setPendingDelete(null);
    setDeleteError(null);
  }

  async function handleConfirmDelete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingDelete) return;
    setDeleteError(null);
    setDeletePending(true);
    try {
      if (pendingDelete.kind === "season") {
        const result = await deleteSeasonAction(pendingDelete.season.id);
        if (!result.ok) {
          setDeleteError(apiErrorMessage(result.code));
          return;
        }
        setSeasons((prev) =>
          withIsCurrent(
            prev.filter((row) => row.id !== pendingDelete.season.id),
            today,
          ),
        );
        if (result.data.warnings.length > 0) setWarnings(result.data.warnings);
      } else {
        const result = await deleteOverrideAction(pendingDelete.override.id);
        if (!result.ok) {
          setDeleteError(apiErrorMessage(result.code));
          return;
        }
        setOverrides((prev) => prev.filter((row) => row.id !== pendingDelete.override.id));
        if (result.data.warnings.length > 0) setWarnings(result.data.warnings);
      }
      setPendingDelete(null);
      await refreshPreview(weekStart);
    } finally {
      setDeletePending(false);
    }
  }

  async function handleCopyNextYear(): Promise<{ insertedCount: number } | { error: string }> {
    const result = await copyNextYearAction();
    if (!result.ok) return { error: apiErrorMessage(result.code) };
    const inserted = result.data.inserted;
    if (inserted.length > 0) {
      setSeasons((prev) => {
        const next = [...prev, ...inserted].sort((a, b) => a.startDate.localeCompare(b.startDate));
        return withIsCurrent(next, today);
      });
      await refreshPreview(weekStart);
    }
    return { insertedCount: inserted.length };
  }

  async function handleOverrideSubmit(
    body: CreateOverrideBody | PatchOverrideBody,
    mode: "create" | "patch",
  ): Promise<string | null> {
    setOverridePending(true);
    try {
      if (mode === "create") {
        const result = await createOverrideAction(body as CreateOverrideBody);
        if (!result.ok) return apiErrorMessage(result.code);
        setOverrides((prev) =>
          [...prev, result.data.override].sort((a, b) => a.startDate.localeCompare(b.startDate)),
        );
        if (result.data.warnings.length > 0) setWarnings(result.data.warnings);
        setOverrideModalOpen(false);
        await refreshPreview(weekStart);
        return null;
      }
      if (!editingOverride) return "That one-off change no longer exists.";
      const result = await patchOverrideAction(editingOverride.id, body as PatchOverrideBody);
      if (!result.ok) return apiErrorMessage(result.code);
      setOverrides((prev) =>
        prev
          .map((row) => (row.id === editingOverride.id ? result.data.override : row))
          .sort((a, b) => a.startDate.localeCompare(b.startDate)),
      );
      if (result.data.warnings.length > 0) setWarnings(result.data.warnings);
      setOverrideModalOpen(false);
      await refreshPreview(weekStart);
      return null;
    } finally {
      setOverridePending(false);
    }
  }

  async function handleDefaultHoursSubmit(
    body: PatchAvailabilityConfigBody,
  ): Promise<string | null> {
    setDefaultHoursPending(true);
    try {
      const result = await patchAvailabilityConfigAction(body);
      if (!result.ok) return apiErrorMessage(result.code);
      setConfig(result.data);
      setDefaultHoursModalOpen(false);
      await refreshPreview(weekStart);
      return null;
    } finally {
      setDefaultHoursPending(false);
    }
  }

  async function shiftWeek(offset: number) {
    const next = addDaysIso(weekStart, offset);
    setWeekStart(next);
    await refreshPreview(next);
  }

  const confirmTitle =
    pendingDelete?.kind === "season"
      ? `Delete ${pendingDelete.season.name}?`
      : "Delete this one-off change?";
  const confirmDescription =
    pendingDelete?.kind === "season"
      ? "Booked lessons stay on the calendar. If any fall outside the new hours, you'll see them next."
      : "The date returns to its season hours. Booked lessons stay on the calendar.";

  return (
    <main id="main-content" className="flex-1 pb-tab-safe">
      <div className="mx-auto max-w-content px-page pt-8 pb-16 tablet:pt-12 tablet:pb-24 flex flex-col gap-6 tablet:gap-8">
        {/* Header */}
        <div className="flex flex-col gap-3 tablet:flex-row tablet:items-start tablet:justify-between">
          <div>
            <h1 className="text-3xl tablet:text-4xl text-heading">Teaching hours</h1>
            <p className="mt-2 text-sm text-text-secondary">
              Set your hours by season. Each season runs until the next one starts.
            </p>
          </div>
          <div className="hidden tablet:flex items-center gap-3 flex-shrink-0 flex-wrap">
            <CopyToNextYearButton
              nextYearLabel={nextYearLabel}
              onConfirm={handleCopyNextYear}
            />
            <button
              type="button"
              onClick={openAddSeason}
              className="inline-flex items-center justify-center h-11 px-5 rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm transition-opacity duration-150 hover:opacity-90 active:scale-[0.97]"
            >
              + Add season
            </button>
          </div>
        </div>

        {/* ── Default hours ─────────────────────────────────────────────── */}
        <DefaultHoursCard
          config={config}
          firstSeasonDate={firstSeasonDate}
          onEdit={() => setDefaultHoursModalOpen(true)}
        />

        {/* ── Seasons ───────────────────────────────────────────────────── */}
        <section aria-label="Seasons">
          {/* Phone: card with heading */}
          <div className="tablet:hidden rounded-card border border-border bg-background p-5 flex flex-col gap-5">
            <h2
              className="text-base font-heading font-semibold text-heading"
              style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
            >
              Seasons
            </h2>

            {currentSeason ? (
              <SeasonCard season={currentSeason} onEdit={() => openEditSeason(currentSeason)} />
            ) : (
              <p className="text-sm text-text-secondary">
                No season active right now — your default hours above are in effect. Add a season
                to override them for a stretch.
              </p>
            )}

            {upcomingSeasons.length > 0 && (
              <div className="flex flex-col gap-3">
                <h3
                  className="text-sm font-semibold text-text-secondary uppercase tracking-widest"
                >
                  Coming up
                </h3>
                <ul className="flex flex-col gap-2">
                  {upcomingSeasons.map((season) => (
                    <li key={season.id}>
                      <button
                        type="button"
                        onClick={() => openEditSeason(season)}
                        className="w-full text-left rounded-card border border-border bg-surface-soft p-4 min-h-[52px] flex items-center justify-between gap-3 hover:bg-border transition-colors duration-150 active:scale-[0.995]"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-text">
                            {season.name} · {monthDay(season.startDate)}
                          </p>
                          <p className="text-xs text-text-secondary truncate">
                            {upcomingSummary(season)}
                          </p>
                        </div>
                        <span className="text-text-secondary" aria-hidden="true">›</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              type="button"
              onClick={openAddSeason}
              className="inline-flex items-center justify-center h-12 rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm transition-opacity duration-150 hover:opacity-90 active:scale-[0.97]"
            >
              + Add season
            </button>
          </div>

          {/* Desktop: heading row + table */}
          <div className="hidden tablet:flex items-baseline justify-between mb-4">
            <h2
              className="text-xl font-heading text-text"
              style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
            >
              {cycleLabel}
            </h2>
          </div>
          <div className="hidden tablet:block">
            <SeasonsTable
              seasons={seasons}
              onEdit={openEditSeason}
              onDelete={requestDeleteSeason}
            />
          </div>
        </section>

        {/* ── One-off changes — phone card (always visible) ─────────────── */}
        <section
          aria-labelledby="overrides-heading-phone"
          className="tablet:hidden rounded-card border border-border bg-background p-5 flex flex-col gap-4"
        >
          <h2
            id="overrides-heading-phone"
            className="text-base font-heading font-semibold text-heading"
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
          >
            One-off changes
          </h2>
          <OverridesList
            overrides={overrides}
            blockedTimes={blockedTimes}
            onEdit={openEditOverride}
            onDelete={requestDeleteOverride}
          />
          <button
            type="button"
            onClick={openAddOverride}
            className="inline-flex items-center justify-center h-11 px-5 rounded-button border-2 border-button-outline text-button-outline font-bold text-sm transition-opacity duration-150 hover:opacity-80 active:scale-[0.98]"
          >
            + Add a day off or custom hours
          </button>
        </section>

        {/* ── What parents see — phone (always visible) ─────────────────── */}
        <div className="tablet:hidden">
          <WeekPreview
            weekStart={weekStart}
            preview={preview}
            isLoading={previewLoading}
            onPrev={() => shiftWeek(-7)}
            onNext={() => shiftWeek(7)}
          />
        </div>

        {/* ── Desktop: week preview + overrides side-by-side ────────────── */}
        <div className="hidden tablet:grid tablet:grid-cols-[2fr_1fr] tablet:gap-6">
          <WeekPreview
            weekStart={weekStart}
            preview={preview}
            isLoading={previewLoading}
            onPrev={() => shiftWeek(-7)}
            onNext={() => shiftWeek(7)}
          />
          <section
            aria-labelledby="overrides-heading-desktop"
            className="rounded-card border border-border bg-background p-5 flex flex-col gap-4"
          >
            <h3
              id="overrides-heading-desktop"
              className="text-base font-heading text-text"
              style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
            >
              One-off changes
            </h3>
            <OverridesList
              overrides={overrides}
              blockedTimes={blockedTimes}
              onEdit={openEditOverride}
              onDelete={requestDeleteOverride}
            />
            <button
              type="button"
              onClick={openAddOverride}
              className="inline-flex items-center justify-center h-11 px-5 rounded-button border-2 border-button-outline text-button-outline font-bold text-sm transition-opacity duration-150 hover:opacity-80 active:scale-[0.98]"
            >
              + Add a day off or custom hours
            </button>
          </section>
        </div>
      </div>

      <DefaultHoursModal
        open={defaultHoursModalOpen}
        config={config}
        onCancel={() => setDefaultHoursModalOpen(false)}
        onSubmit={handleDefaultHoursSubmit}
        isPending={defaultHoursPending}
      />
      <SeasonFormModal
        open={seasonModalOpen}
        season={editingSeason}
        seasons={seasons}
        onCancel={() => setSeasonModalOpen(false)}
        onSubmit={handleSeasonSubmit}
        isPending={seasonPending}
      />
      <OverrideFormModal
        open={overrideModalOpen}
        override={editingOverride}
        onCancel={() => setOverrideModalOpen(false)}
        onSubmit={handleOverrideSubmit}
        isPending={overridePending}
      />
      <ImpactWarningModal
        open={warningsOpen}
        warnings={warnings}
        onDismiss={() => {
          setWarningsOpen(false);
          setWarnings([]);
        }}
      />

      {/* The form the ConfirmDialog's submit button targets. Lives outside the
          dialog so React keeps the handler attached across open/close cycles. */}
      <form id="availability-delete-form" onSubmit={handleConfirmDelete} className="hidden" />
      <ConfirmDialog
        dialogRef={confirmDialogRef}
        title={confirmTitle}
        description={confirmDescription}
        formId="availability-delete-form"
        confirmLabel="Delete"
        confirmDanger
        cancelLabel="Keep it"
        isPending={deletePending}
        {...(deleteError && { errorMessage: deleteError })}
        onCancel={cancelDelete}
      />
    </main>
  );
}

function monthDay(dateIso: string): string {
  const [year, month, day] = dateIso.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(date);
}

