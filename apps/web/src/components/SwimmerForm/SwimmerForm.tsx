"use client";

import { useState } from "react";

import type { Club, SwimmerClubInput } from "@swim-app/shared";

import Button from "@/components/Button";
import FieldError from "@/components/FieldError";

import ClubCombobox from "./ClubCombobox";

type SwimmerFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "field_errors"; errors: Record<string, string> };

interface SwimmerFormInitialValues {
  firstName?: string;
  lastName?: string;
  birthDate?: string;
  sex?: "female" | "male";
  isPublic?: boolean;
  clubs?: SwimmerClubInput[];
}

interface SwimmerFormProps {
  clubs: Club[];
  formAction: (formData: FormData) => void;
  state: SwimmerFormState;
  isPending: boolean;
  mode: "add" | "edit";
  swimmerId?: string;
  initialValues?: SwimmerFormInitialValues;
}

const inputClass =
  "h-12 px-4 rounded-lg border border-border bg-background text-text placeholder:text-text-secondary focus:outline-none focus:border-accent";

export default function SwimmerForm({
  clubs,
  formAction,
  state,
  isPending,
  mode,
  swimmerId,
  initialValues,
}: SwimmerFormProps) {
  const [isPublicValue, setIsPublicValue] = useState<"yes" | "no" | null>(
    () =>
      initialValues?.isPublic === true
        ? "yes"
        : initialValues?.isPublic === false
          ? "no"
          : null,
  );

  // "yes" / "no" / null (null = not yet chosen, only possible in add mode)
  const [onTeam, setOnTeam] = useState<"yes" | "no" | null>(() => {
    if (initialValues === undefined) return null;
    return (initialValues.clubs?.length ?? 0) > 0 ? "yes" : "no";
  });

  // "" = not yet picked, "other" = other, or a club UUID
  const [clubSelection, setClubSelection] = useState<string>(() => {
    const first = initialValues?.clubs?.[0];
    if (!first) return "";
    return "clubId" in first ? first.clubId : "other";
  });

  const [otherClubName, setOtherClubName] = useState<string>(() => {
    const first = initialValues?.clubs?.[0];
    if (!first || "clubId" in first) return "";
    return first.otherClubName;
  });

  const fieldErrors = state.status === "field_errors" ? state.errors : {};
  const topError = state.status === "error" ? state.message : null;

  const showPublicToPrivateNote =
    mode === "edit" && initialValues?.isPublic === true && isPublicValue === "no";

  // Build the clubs payload for the hidden input
  const clubsJson = (() => {
    if (onTeam !== "yes" || clubSelection === "") return "[]";

    let current: SwimmerClubInput;
    if (clubSelection === "other") {
      const trimmed = otherClubName.trim();
      if (!trimmed) return "[]";
      current = { otherClubName: trimmed };
    } else {
      current = { clubId: clubSelection };
    }

    // In edit mode, preserve extra clubs when the first club hasn't changed
    if (mode === "edit") {
      const initialFirst = initialValues?.clubs?.[0];
      const extras = initialValues?.clubs?.slice(1) ?? [];
      const unchanged =
        !!initialFirst &&
        (("clubId" in current &&
          "clubId" in initialFirst &&
          current.clubId === initialFirst.clubId) ||
          ("otherClubName" in current &&
            "otherClubName" in initialFirst &&
            current.otherClubName === initialFirst.otherClubName));
      if (unchanged && extras.length > 0) {
        return JSON.stringify([current, ...extras]);
      }
    }

    return JSON.stringify([current]);
  })();

  const initialJson =
    mode === "edit" && initialValues ? JSON.stringify(initialValues) : null;

  const clubSelectionComplete =
    onTeam !== "yes" ||
    (clubSelection !== "" && clubSelection !== "other") ||
    (clubSelection === "other" && otherClubName.trim() !== "");

  const isSubmitDisabled =
    onTeam === null ||
    !clubSelectionComplete ||
    (mode === "add" && isPublicValue === null) ||
    isPending;

  const submitLabel = mode === "add" ? "Add swimmer" : "Save changes";
  const pendingLabel = mode === "add" ? "Adding swimmer…" : "Saving…";

  return (
    <form action={formAction} noValidate className="flex flex-col gap-6">
      {topError && (
        <p aria-live="polite" role="alert" className="text-danger text-sm">
          {topError}
        </p>
      )}

      {/* First name */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="firstName" className="text-sm font-semibold text-text">
          First name
        </label>
        <input
          id="firstName"
          name="firstName"
          type="text"
          autoComplete="given-name"
          required
          defaultValue={initialValues?.firstName}
          aria-describedby={fieldErrors["firstName"] ? "firstName-error" : undefined}
          className={inputClass}
        />
        <FieldError id="firstName-error" message={fieldErrors["firstName"]} />
      </div>

      {/* Last name */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="lastName" className="text-sm font-semibold text-text">
          Last name
        </label>
        <input
          id="lastName"
          name="lastName"
          type="text"
          autoComplete="family-name"
          required
          defaultValue={initialValues?.lastName}
          aria-describedby={fieldErrors["lastName"] ? "lastName-error" : undefined}
          className={inputClass}
        />
        <FieldError id="lastName-error" message={fieldErrors["lastName"]} />
      </div>

      {/* Birth date */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="birthDate" className="text-sm font-semibold text-text">
          Date of birth
        </label>
        <input
          id="birthDate"
          name="birthDate"
          type="date"
          required
          defaultValue={initialValues?.birthDate}
          aria-describedby={fieldErrors["birthDate"] ? "birthDate-error" : undefined}
          className={inputClass}
        />
        <FieldError id="birthDate-error" message={fieldErrors["birthDate"]} />
      </div>

      {/* Competition category */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-text">Competition category</legend>
        <p className="text-xs text-text-secondary mt-0.5">
          Used to place your swimmer in the correct age group.
        </p>
        <div className="flex gap-6 mt-1">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-text min-h-[44px]">
            <input
              type="radio"
              name="sex"
              value="female"
              defaultChecked={initialValues?.sex === "female"}
              className="accent-button-primary-background"
              aria-describedby={fieldErrors["sex"] ? "sex-error" : undefined}
            />
            Female
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-text min-h-[44px]">
            <input
              type="radio"
              name="sex"
              value="male"
              defaultChecked={initialValues?.sex === "male"}
              className="accent-button-primary-background"
            />
            Male
          </label>
        </div>
        <FieldError id="sex-error" message={fieldErrors["sex"]} />
      </fieldset>

      {/* Clubs */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-text">
          Is your swimmer on a swim club or team?
        </legend>
        <div className="flex gap-6">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-text min-h-[44px]">
            <input
              type="radio"
              name="onTeam"
              value="yes"
              checked={onTeam === "yes"}
              onChange={() => setOnTeam("yes")}
              className="accent-button-primary-background"
              aria-describedby={fieldErrors["clubs"] ? "clubs-error" : undefined}
            />
            Yes
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-text min-h-[44px]">
            <input
              type="radio"
              name="onTeam"
              value="no"
              checked={onTeam === "no"}
              onChange={() => {
                setOnTeam("no");
                setClubSelection("");
                setOtherClubName("");
              }}
              className="accent-button-primary-background"
            />
            No
          </label>
        </div>

        {onTeam === "yes" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="clubSelect" className="text-sm font-semibold text-text">
                Club or team
              </label>
              <ClubCombobox
                inputId="clubSelect"
                clubs={clubs}
                value={clubSelection}
                onChange={(next) => {
                  setClubSelection(next);
                  if (next !== "other") setOtherClubName("");
                }}
                {...(fieldErrors["clubs"] && { describedBy: "clubs-error" })}
              />
            </div>

            {clubSelection === "other" && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="otherClubName" className="text-sm font-semibold text-text">
                  Club name
                </label>
                <input
                  id="otherClubName"
                  type="text"
                  value={otherClubName}
                  onChange={(event) => setOtherClubName(event.target.value)}
                  placeholder="Enter club or team name"
                  className={inputClass}
                />
              </div>
            )}
          </div>
        )}

        {onTeam === null && mode === "add" && (
          <p className="text-text-secondary text-xs">Please select Yes or No to continue.</p>
        )}

        <FieldError id="clubs-error" message={fieldErrors["clubs"]} />
      </fieldset>

      {/* Public leaderboards */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-text">Public leaderboards</legend>
        <p className="text-xs text-text-secondary mt-0.5">
          Choosing Yes shows your swimmer's first name and last initial, times, and level
          on the public leaderboard. Swim progress is tracked either way — this setting
          only affects what others can see.
        </p>
        <div className="flex gap-6 mt-1">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-text min-h-[44px]">
            <input
              type="radio"
              name="isPublic"
              value="yes"
              checked={isPublicValue === "yes"}
              onChange={() => setIsPublicValue("yes")}
              className="accent-button-primary-background"
              aria-describedby={fieldErrors["isPublic"] ? "isPublic-error" : undefined}
            />
            Yes
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-text min-h-[44px]">
            <input
              type="radio"
              name="isPublic"
              value="no"
              checked={isPublicValue === "no"}
              onChange={() => setIsPublicValue("no")}
              className="accent-button-primary-background"
            />
            No
          </label>
        </div>
        <p className="text-text-secondary text-xs">
          Changes can take up to a minute to show on public leaderboards.
        </p>
        {mode === "add" && isPublicValue === null && (
          <p className="text-text-secondary text-xs">Please select Yes or No to continue.</p>
        )}
        {showPublicToPrivateNote && (
          <p className="text-text-secondary text-xs">
            Switching to No will remove your swimmer from public leaderboards.
          </p>
        )}
        <FieldError id="isPublic-error" message={fieldErrors["isPublic"]} />
      </fieldset>

      <input type="hidden" name="clubsJson" value={clubsJson} />
      {mode === "edit" && swimmerId && (
        <input type="hidden" name="swimmerId" value={swimmerId} />
      )}
      {mode === "edit" && initialJson && (
        <input type="hidden" name="initialJson" value={initialJson} />
      )}

      <Button type="submit" disabled={isSubmitDisabled} className="w-full mt-2">
        {isPending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}
