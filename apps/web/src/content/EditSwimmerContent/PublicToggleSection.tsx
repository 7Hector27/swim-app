"use client";

import { useActionState, useState } from "react";

import type { HouseholdRole } from "@swim-app/shared";

import { toggleSwimmerPublic } from "./actions";
import type { PublicToggleState } from "./helpers";

interface PublicToggleSectionProps {
  swimmerId: string;
  isPublic: boolean;
  householdRole: HouseholdRole;
  swimmerFirstName: string;
}

const initialState: PublicToggleState = { status: "idle" };

const buttonBase =
  "inline-flex items-center justify-center rounded-button font-bold text-sm px-5 min-h-[44px] transition-opacity disabled:opacity-50 hover:opacity-80 active:scale-[0.97]";

export default function PublicToggleSection({
  swimmerId,
  isPublic,
  householdRole,
  swimmerFirstName,
}: PublicToggleSectionProps) {
  const [consentChecked, setConsentChecked] = useState(false);

  const enableAction = toggleSwimmerPublic.bind(null, swimmerId, true);
  const disableAction = toggleSwimmerPublic.bind(null, swimmerId, false);

  const [enableState, enableFormAction, isEnablePending] = useActionState(
    enableAction,
    initialState,
  );
  const [disableState, disableFormAction, isDisablePending] = useActionState(
    disableAction,
    initialState,
  );

  const canEnable = householdRole === "owner";
  const canDisable = householdRole === "owner" || householdRole === "manager";

  const errorMessage =
    enableState.status === "error"
      ? enableState.message
      : disableState.status === "error"
        ? disableState.message
        : null;

  return (
    <section className="flex flex-col gap-4 border-t border-border pt-8">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold text-text">Show on public leaderboards</h2>
        <p className="text-xs text-text-secondary">
          {isPublic
            ? `${swimmerFirstName} is currently visible on public leaderboards (first name, last initial, age group, and meet times).`
            : `${swimmerFirstName} is currently hidden from public leaderboards.`}
        </p>
        <p className="text-xs text-text-secondary">
          Changes can take up to a minute to reflect on public leaderboards.
        </p>
      </div>

      {errorMessage && (
        <p role="alert" aria-live="polite" className="text-danger text-sm">
          {errorMessage}
        </p>
      )}

      {isPublic ? (
        canDisable ? (
          <form action={disableFormAction}>
            <button
              type="submit"
              disabled={isDisablePending}
              className={`${buttonBase} border border-danger text-danger`}
            >
              {isDisablePending ? "Removing…" : "Remove from leaderboards"}
            </button>
          </form>
        ) : (
          <p className="text-xs text-text-secondary">
            Contact the household owner or manager to remove this swimmer from leaderboards.
          </p>
        )
      ) : canEnable ? (
        <div className="flex flex-col gap-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(event) => setConsentChecked(event.target.checked)}
              className="mt-1 accent-button-primary-background min-w-[20px]"
              aria-describedby="consent-description"
            />
            <span id="consent-description" className="text-sm text-text">
              I understand that {swimmerFirstName}&apos;s first name, last initial, age group,
              and meet times will be visible to anyone on the public leaderboard.
            </span>
          </label>
          <form action={enableFormAction}>
            <button
              type="submit"
              disabled={!consentChecked || isEnablePending}
              className={`${buttonBase} bg-button-primary-background text-button-primary-text`}
            >
              {isEnablePending ? "Enabling…" : "Show on leaderboards"}
            </button>
          </form>
        </div>
      ) : (
        <p className="text-xs text-text-secondary">
          {householdRole === "viewer"
            ? "Contact the household owner to change this setting."
            : "Only the household owner can make a swimmer public."}
        </p>
      )}
    </section>
  );
}
