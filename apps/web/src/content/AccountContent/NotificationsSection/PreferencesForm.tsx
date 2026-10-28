"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CoachNotificationPreferences,
  CoachNotificationPreferencesPatch,
} from "@swim-app/shared";

import {
  fetchNotificationPreferences,
  patchNotificationPreferences,
} from "@/lib/api/coachAlerts";

type SaveState = "idle" | "saving" | "saved" | "error";

export default function PreferencesForm() {
  const [prefs, setPrefs] = useState<CoachNotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const savedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void (async () => {
      const result = await fetchNotificationPreferences();
      if (result.ok) setPrefs(result.data);
      setLoading(false);
    })();
    return () => {
      if (savedTimeout.current) clearTimeout(savedTimeout.current);
    };
  }, []);

  const persist = useCallback(
    async (patch: CoachNotificationPreferencesPatch) => {
      setSaveState("saving");
      const result = await patchNotificationPreferences(patch);
      if (!result.ok) {
        setSaveState("error");
        return;
      }
      setPrefs(result.data);
      setSaveState("saved");
      if (savedTimeout.current) clearTimeout(savedTimeout.current);
      savedTimeout.current = setTimeout(() => {
        setSaveState((state) => (state === "saved" ? "idle" : state));
      }, 1800);
    },
    [],
  );

  if (loading) {
    return <p className="text-sm text-text-secondary">Loading settings…</p>;
  }
  if (!prefs) {
    return (
      <p role="alert" className="text-sm text-danger">
        Could not load settings. Reload the page to try again.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <SaveIndicator state={saveState} />

      <section className="flex flex-col gap-3">
        <SectionHeader>Categories</SectionHeader>
        <Toggle
          label="New booking requests"
          description="A parent asked for a lesson."
          checked={prefs.bookingRequestEnabled}
          onChange={(value) => persist({ bookingRequestEnabled: value })}
        />
        <Toggle
          label="Email backup for booking requests"
          description="If no device is enabled, send an email instead."
          checked={prefs.bookingRequestEmailBackupEnabled}
          onChange={(value) => persist({ bookingRequestEmailBackupEnabled: value })}
        />
        <Toggle
          label="Expiring requests"
          description="A pending request is about to time out."
          checked={prefs.requestExpiringSoonEnabled}
          onChange={(value) => persist({ requestExpiringSoonEnabled: value })}
        />
        <Toggle
          label="Parent cancels or reschedules"
          description="A parent changed a confirmed lesson."
          checked={prefs.parentChangeEnabled}
          onChange={(value) => persist({ parentChangeEnabled: value })}
        />

        <div className="flex items-center justify-between gap-3 py-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-text">Auto-approved bookings</span>
            <span className="text-xs text-text-secondary">
              Repeat households at trusted pools skip the queue.
            </span>
          </div>
          <select
            className="rounded-button border border-border bg-background text-text text-sm px-3 h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            value={prefs.autoApprovedMode}
            onChange={(event) => {
              const value = event.target.value as "off" | "summary" | "immediate";
              void persist({ autoApprovedMode: value });
            }}
          >
            <option value="off">Off</option>
            <option value="summary">In daily summary</option>
            <option value="immediate">Immediate push</option>
          </select>
        </div>

        <StaticRow label="Calendar disconnected" value="Always on" />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeader>Quiet hours</SectionHeader>
        <Toggle
          label="Hold non-urgent pushes overnight"
          description="Alerts for lessons more than 12 hours out wait."
          checked={prefs.quietHoursEnabled}
          onChange={(value) => persist({ quietHoursEnabled: value })}
        />
        <div className="grid grid-cols-2 gap-3">
          <TimeField
            label="Start"
            value={prefs.quietHoursStartLocal}
            onChange={(value) => persist({ quietHoursStartLocal: value })}
            disabled={!prefs.quietHoursEnabled}
          />
          <TimeField
            label="End"
            value={prefs.quietHoursEndLocal}
            onChange={(value) => persist({ quietHoursEndLocal: value })}
            disabled={!prefs.quietHoursEnabled}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeader>Daily summary</SectionHeader>
        <Toggle
          label="Send a daily summary"
          description="One push each morning with today&rsquo;s plan."
          checked={prefs.dailySummaryEnabled}
          onChange={(value) => persist({ dailySummaryEnabled: value })}
        />
        <TimeField
          label="Send at"
          value={prefs.dailySummaryTimeLocal}
          onChange={(value) => persist({ dailySummaryTimeLocal: value })}
          disabled={!prefs.dailySummaryEnabled}
        />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeader>Lock-screen detail</SectionHeader>
        <div className="flex items-center justify-between gap-3 py-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-text">What swimmers&rsquo; names look like</span>
            <span className="text-xs text-text-secondary">
              Shoulder-safe (first name + initial) is the default.
            </span>
          </div>
          <select
            className="rounded-button border border-border bg-background text-text text-sm px-3 h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            value={prefs.lockScreenDetail}
            onChange={(event) => {
              const value = event.target.value as "first_initial" | "full_name";
              void persist({ lockScreenDetail: value });
            }}
          >
            <option value="first_initial">First name + initial</option>
            <option value="full_name">Full name</option>
          </select>
        </div>
      </section>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
      {children}
    </h3>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  // Live region so screen readers hear "Saved" without the sighted user
  // needing to track a toast. Visually it's a quiet caption.
  return (
    <p
      aria-live="polite"
      className={`text-xs min-h-[1rem] transition-opacity duration-200 ${
        state === "idle" ? "opacity-0" : "opacity-100"
      } ${state === "error" ? "text-danger" : "text-text-secondary"}`}
    >
      {state === "saving"
        ? "Saving…"
        : state === "saved"
          ? "Saved"
          : state === "error"
            ? "Could not save. Try again."
            : ""}
    </p>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-2 cursor-pointer">
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-text">{label}</span>
        <span className="text-xs text-text-secondary">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 accent-accent cursor-pointer"
      />
    </label>
  );
}

function TimeField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  // "HH:MM" or "HH:MM:SS" — the HTML time input needs "HH:MM".
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const normalized = value.length >= 5 ? value.slice(0, 5) : value;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-text-secondary">{label}</span>
      <input
        type="time"
        value={normalized}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-button border border-border bg-background text-text text-sm px-3 h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-60"
      />
    </label>
  );
}

function StaticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm font-semibold text-text">{label}</span>
      <span className="text-xs font-semibold text-text-secondary">{value}</span>
    </div>
  );
}
