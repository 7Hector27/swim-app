"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  copyNextYear,
  createOverride,
  createSeason,
  deleteOverride,
  deleteSeason,
  fetchAvailabilityPreview,
  patchAvailabilityConfig,
  patchOverride,
  patchSeason,
} from "@/lib/api/coachAvailability";
import { addDaysIso } from "./availabilityFormat";
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
  accessToken: string;
  initialSeasons: SeasonWithIsCurrent[];
  initialOverrides: AvailabilityOverride[];
  initialBlockedTimes: BlockedTime[];
  initialPreview: AvailabilityPreviewResponse;
  initialWeekStart: string;
  initialConfig: AvailabilityConfig;
  today: string;
}

type PhoneTab = "seasons" | "overrides";

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
  accessToken,
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

  const [phoneTab, setPhoneTab] = useState<PhoneTab>("seasons");

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
    const response = await fetchAvailabilityPreview(accessToken, nextWeekStart, 7);
    setPreview(response);
    setPreviewLoading(false);
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

  function openAddSeason() {
    setEditingSeason(null);
    setSeasonModalOpen(true);
  }
  function openEditSeason(season: SeasonWithIsCurrent) {
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
        const result = await createSeason(accessToken, body as CreateSeasonBody);
        if (!result.ok) return apiErrorMessage(result.code);
        setSeasons((prev) =>
          [...prev.map((season) => ({ ...season, isCurrent: false })), result.data.season].sort(
            (a, b) => a.startDate.localeCompare(b.startDate),
          ),
        );
        if (result.data.warnings.length > 0) setWarnings(result.data.warnings);
        setSeasonModalOpen(false);
        await refreshPreview(weekStart);
        return null;
      }
      if (!editingSeason) return "Season no longer exists.";
      const result = await patchSeason(accessToken, editingSeason.id, body as PatchSeasonBody);
      if (!result.ok) return apiErrorMessage(result.code);
      setSeasons((prev) =>
        prev
          .map((season) => (season.id === editingSeason.id ? result.data.season : season))
          .sort((a, b) => a.startDate.localeCompare(b.startDate)),
      );
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
        const result = await deleteSeason(accessToken, pendingDelete.season.id);
        if (!result.ok) {
          setDeleteError(apiErrorMessage(result.code));
          return;
        }
        setSeasons((prev) => prev.filter((row) => row.id !== pendingDelete.season.id));
        if (result.data.warnings.length > 0) setWarnings(result.data.warnings);
      } else {
        const result = await deleteOverride(accessToken, pendingDelete.override.id);
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
    const result = await copyNextYear(accessToken);
    if (!result.ok) return { error: apiErrorMessage(result.code) };
    const inserted = result.data.inserted;
    if (inserted.length > 0) {
      setSeasons((prev) =>
        [...prev, ...inserted.map((season) => ({ ...season, isCurrent: false }))].sort((a, b) =>
          a.startDate.localeCompare(b.startDate),
        ),
      );
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
        const result = await createOverride(accessToken, body as CreateOverrideBody);
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
      const result = await patchOverride(accessToken, editingOverride.id, body as PatchOverrideBody);
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
      const result = await patchAvailabilityConfig(accessToken, body);
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
      <div className="mx-auto max-w-content px-page pt-8 pb-16 tablet:pt-12 tablet:pb-24 flex flex-col gap-8">
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

        <DefaultHoursCard
          config={config}
          firstSeasonDate={firstSeasonDate}
          onEdit={() => setDefaultHoursModalOpen(true)}
        />

        {/* Phone tabs */}
        <div className="tablet:hidden">
          <div className="inline-flex rounded-full bg-surface-soft p-1 w-full">
            <TabButton active={phoneTab === "seasons"} onClick={() => setPhoneTab("seasons")}>
              Seasons
            </TabButton>
            <TabButton active={phoneTab === "overrides"} onClick={() => setPhoneTab("overrides")}>
              One-off changes
            </TabButton>
          </div>
        </div>

        {/* Desktop: seasons table */}
        <section
          aria-labelledby="seasons-section-title"
          className={`${phoneTab === "seasons" ? "" : "hidden"} tablet:block flex flex-col gap-4`}
        >
          <div className="hidden tablet:flex items-baseline justify-between">
            <h2
              id="seasons-section-title"
              className="text-xl font-heading text-text"
              style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
            >
              {cycleLabel}
            </h2>
          </div>

          {/* Phone: current season card + upcoming list */}
          <div className="tablet:hidden flex flex-col gap-6">
            {currentSeason ? (
              <SeasonCard season={currentSeason} onEdit={() => openEditSeason(currentSeason)} />
            ) : (
              <p className="text-sm text-text-secondary">
                No season active right now — your default hours above are in effect. Add a season
                to override them for a stretch.
              </p>
            )}

            {upcomingSeasons.length > 0 && (
              <section aria-labelledby="upcoming-seasons-title" className="flex flex-col gap-3">
                <h3
                  id="upcoming-seasons-title"
                  className="text-base font-heading text-text"
                  style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
                >
                  Coming up
                </h3>
                <ul className="flex flex-col gap-2">
                  {upcomingSeasons.map((season) => (
                    <li key={season.id}>
                      <button
                        type="button"
                        onClick={() => openEditSeason(season)}
                        className="w-full text-left rounded-card border border-border bg-background p-4 min-h-[52px] flex items-center justify-between gap-3 hover:bg-surface-soft transition-colors duration-150 active:scale-[0.995]"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-text">
                            {season.name} · {monthDay(season.startDate)}
                          </p>
                          <p className="text-xs text-text-secondary truncate">
                            {upcomingSummary(season)}
                          </p>
                        </div>
                        <span className="text-text-secondary" aria-hidden="true">
                          ›
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <button
              type="button"
              onClick={openAddSeason}
              className="inline-flex items-center justify-center h-12 rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm transition-opacity duration-150 hover:opacity-90 active:scale-[0.97]"
            >
              + Add season
            </button>
          </div>

          <div className="hidden tablet:block">
            <SeasonsTable
              seasons={seasons}
              onEdit={openEditSeason}
              onDelete={requestDeleteSeason}
            />
          </div>
        </section>

        {/* Desktop: week preview + overrides side-by-side; phone: stacked under tab */}
        <div
          className={`${phoneTab === "overrides" ? "" : "hidden"} tablet:grid tablet:grid-cols-[2fr_1fr] tablet:gap-6 flex flex-col gap-6`}
        >
          <div className="hidden tablet:block">
            <WeekPreview
              weekStart={weekStart}
              preview={preview}
              isLoading={previewLoading}
              onPrev={() => shiftWeek(-7)}
              onNext={() => shiftWeek(7)}
            />
          </div>

          <section
            aria-labelledby="overrides-section-title"
            className="rounded-card border border-border bg-background p-5 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h3
                id="overrides-section-title"
                className="text-base font-heading text-text"
                style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
              >
                One-off changes
              </h3>
            </div>
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

        {/* Phone: week preview appears under the seasons tab for context */}
        <div className={`${phoneTab === "seasons" ? "" : "hidden"} tablet:hidden`}>
          <WeekPreview
            weekStart={weekStart}
            preview={preview}
            isLoading={previewLoading}
            onPrev={() => shiftWeek(-7)}
            onNext={() => shiftWeek(7)}
          />
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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 inline-flex items-center justify-center h-11 rounded-full text-sm font-bold transition-colors duration-150 ${
        active ? "bg-button-primary-background text-button-primary-text" : "text-text-secondary"
      }`}
    >
      {children}
    </button>
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

function upcomingSummary(season: SeasonWithIsCurrent): string {
  const parts: string[] = [];
  if (season.weekdayStartTime) parts.push(`${time12(season.weekdayStartTime)} weekdays`);
  if (
    season.weekendStartTime &&
    season.weekendStartTime !== season.weekdayStartTime
  ) {
    parts.push(`${time12(season.weekendStartTime)} weekends`);
  }
  parts.push(`ends ${time12(season.endTime)}`);
  return parts.join(" · ");
}

function time12(time: string): string {
  const [hoursStr, minutes] = time.split(":") as [string, string];
  const hours = Number(hoursStr);
  const period = hours >= 12 ? "pm" : "am";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${minutes} ${period}`;
}
