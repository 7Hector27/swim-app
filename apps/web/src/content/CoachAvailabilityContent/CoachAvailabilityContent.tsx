"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AvailabilityOverride,
  AvailabilityPreviewResponse,
  BlockedTime,
  CreateOverrideBody,
  CreateSeasonBody,
  ImpactWarning,
  PatchSeasonBody,
  SeasonWithIsCurrent,
} from "@swim-app/shared";

import { apiErrorMessage } from "@/lib/apiErrorMessage";
import {
  copyNextYear,
  createOverride,
  createSeason,
  deleteOverride,
  deleteSeason,
  fetchAvailabilityPreview,
  patchSeason,
} from "@/lib/api/coachAvailability";
import { addDaysIso } from "./availabilityFormat";
import CopyToNextYearButton from "./CopyToNextYearButton";
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
  today: string;
}

type PhoneTab = "seasons" | "overrides";

export default function CoachAvailabilityContent({
  accessToken,
  initialSeasons,
  initialOverrides,
  initialBlockedTimes,
  initialPreview,
  initialWeekStart,
  today,
}: Props) {
  const [seasons, setSeasons] = useState(initialSeasons);
  const [overrides, setOverrides] = useState(initialOverrides);
  const [blockedTimes] = useState(initialBlockedTimes);
  const [preview, setPreview] = useState(initialPreview);
  const [weekStart, setWeekStart] = useState(initialWeekStart);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [seasonModalOpen, setSeasonModalOpen] = useState(false);
  const [editingSeason, setEditingSeason] = useState<SeasonWithIsCurrent | null>(null);
  const [seasonPending, setSeasonPending] = useState(false);

  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overridePending, setOverridePending] = useState(false);

  const [warnings, setWarnings] = useState<ImpactWarning[]>([]);
  const [warningsOpen, setWarningsOpen] = useState(false);

  const [phoneTab, setPhoneTab] = useState<PhoneTab>("seasons");

  const currentSeason = useMemo(() => seasons.find((season) => season.isCurrent) ?? null, [seasons]);
  const upcomingSeasons = useMemo(
    () => seasons.filter((season) => season.startDate > today),
    [seasons, today],
  );
  const nextYearLabel = useMemo(() => {
    const latest = [...seasons].sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
    const base = latest ? Number(latest.startDate.slice(0, 4)) : new Date().getUTCFullYear();
    return `${base + 1}`;
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

  function openAddSeason() {
    setEditingSeason(null);
    setSeasonModalOpen(true);
  }
  function openEditSeason(season: SeasonWithIsCurrent) {
    setEditingSeason(season);
    setSeasonModalOpen(true);
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

  async function handleDeleteSeason(season: SeasonWithIsCurrent) {
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(`Delete ${season.name}? Booked lessons will stay on the calendar.`);
    if (!confirmed) return;
    const result = await deleteSeason(accessToken, season.id);
    if (!result.ok) {
      window.alert(apiErrorMessage(result.code));
      return;
    }
    setSeasons((prev) => prev.filter((row) => row.id !== season.id));
    if (result.data.warnings.length > 0) setWarnings(result.data.warnings);
    await refreshPreview(weekStart);
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

  async function handleOverrideSubmit(body: CreateOverrideBody): Promise<string | null> {
    setOverridePending(true);
    try {
      const result = await createOverride(accessToken, body);
      if (!result.ok) return apiErrorMessage(result.code);
      setOverrides((prev) =>
        [...prev, result.data.override].sort((a, b) => a.startDate.localeCompare(b.startDate)),
      );
      if (result.data.warnings.length > 0) setWarnings(result.data.warnings);
      setOverrideModalOpen(false);
      await refreshPreview(weekStart);
      return null;
    } finally {
      setOverridePending(false);
    }
  }

  async function handleDeleteOverride(override: AvailabilityOverride) {
    const confirmed =
      typeof window === "undefined" ? true : window.confirm("Delete this one-off change?");
    if (!confirmed) return;
    const result = await deleteOverride(accessToken, override.id);
    if (!result.ok) {
      window.alert(apiErrorMessage(result.code));
      return;
    }
    setOverrides((prev) => prev.filter((row) => row.id !== override.id));
    if (result.data.warnings.length > 0) setWarnings(result.data.warnings);
    await refreshPreview(weekStart);
  }

  async function shiftWeek(offset: number) {
    const next = addDaysIso(weekStart, offset);
    setWeekStart(next);
    await refreshPreview(next);
  }

  const latestYear = useMemo(() => {
    const latest = [...seasons].sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
    return latest ? Number(latest.startDate.slice(0, 4)) : null;
  }, [seasons]);
  const cycleLabel = useMemo(() => {
    if (!latestYear) return "Seasons";
    return `${latestYear - 1}–${String(latestYear).slice(2)} seasons`;
  }, [latestYear]);

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
              className="text-xl font-heading text-text-on-section"
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
                No active season yet. Add one to set your teaching hours.
              </p>
            )}

            {upcomingSeasons.length > 0 && (
              <section aria-labelledby="upcoming-seasons-title" className="flex flex-col gap-3">
                <h3
                  id="upcoming-seasons-title"
                  className="text-base font-heading text-heading"
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
                        className="w-full text-left rounded-card border border-border bg-section p-4 min-h-[52px] flex items-center justify-between gap-3 hover:bg-surface-soft transition-colors duration-150 active:scale-[0.995]"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-text-on-section">
                            {season.name} · {monthDay(season.startDate)}
                          </p>
                          <p className="text-xs text-text-secondary-on-section truncate">
                            {upcomingSummary(season)}
                          </p>
                        </div>
                        <span className="text-text-secondary-on-section" aria-hidden="true">
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
              onDelete={handleDeleteSeason}
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
            className="rounded-card border border-border bg-section p-5 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h3
                id="overrides-section-title"
                className="text-base font-heading text-text-on-section"
                style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
              >
                One-off changes
              </h3>
            </div>
            <OverridesList
              overrides={overrides}
              blockedTimes={blockedTimes}
              onDelete={handleDeleteOverride}
            />
            <button
              type="button"
              onClick={() => setOverrideModalOpen(true)}
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

      <SeasonFormModal
        open={seasonModalOpen}
        season={editingSeason}
        onCancel={() => setSeasonModalOpen(false)}
        onSubmit={handleSeasonSubmit}
        isPending={seasonPending}
      />
      <OverrideFormModal
        open={overrideModalOpen}
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
