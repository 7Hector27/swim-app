"use client";

import { useRef, useState } from "react";

import type { Club, SwimmerClubInput } from "@swim-app/shared";

import Button from "@/components/Button";
import FieldError from "@/components/FieldError";

type SwimmerFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "field_errors"; errors: Record<string, string> };

type OtherClub = { id: number; value: string };

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
  const initClubIds = initialValues?.clubs
    ?.filter((c): c is { clubId: string } => "clubId" in c)
    .map((c) => c.clubId) ?? [];
  const initOtherClubs: OtherClub[] = initialValues?.clubs
    ?.filter((c): c is { otherClubName: string } => "otherClubName" in c)
    .map((c, index) => ({ id: index + 1, value: c.otherClubName })) ?? [];

  const otherIdRef = useRef(initOtherClubs.length);
  const [selectedClubIds, setSelectedClubIds] = useState<Set<string>>(
    () => new Set(initClubIds),
  );
  const [otherClubs, setOtherClubs] = useState<OtherClub[]>(() => initOtherClubs);
  const [isPublicValue, setIsPublicValue] = useState<"yes" | "no" | null>(
    () =>
      initialValues?.isPublic === true
        ? "yes"
        : initialValues?.isPublic === false
          ? "no"
          : null,
  );

  const fieldErrors = state.status === "field_errors" ? state.errors : {};
  const topError = state.status === "error" ? state.message : null;

  const showPublicToPrivateNote =
    mode === "edit" && initialValues?.isPublic === true && isPublicValue === "no";

  function toggleClub(clubId: string) {
    setSelectedClubIds((prev) => {
      const next = new Set(prev);
      if (next.has(clubId)) {
        next.delete(clubId);
      } else {
        next.add(clubId);
      }
      return next;
    });
  }

  function toggleOther(checked: boolean) {
    if (checked) {
      otherIdRef.current += 1;
      setOtherClubs([{ id: otherIdRef.current, value: "" }]);
    } else {
      setOtherClubs([]);
    }
  }

  function updateOtherValue(entryId: number, value: string) {
    setOtherClubs((prev) =>
      prev.map((entry) => (entry.id === entryId ? { ...entry, value } : entry)),
    );
  }

  function removeOtherEntry(entryId: number) {
    setOtherClubs((prev) => prev.filter((entry) => entry.id !== entryId));
  }

  function addOtherEntry() {
    otherIdRef.current += 1;
    setOtherClubs((prev) => [...prev, { id: otherIdRef.current, value: "" }]);
  }

  const clubsJson = JSON.stringify([
    ...[...selectedClubIds].map((id) => ({ clubId: id })),
    ...otherClubs
      .filter((entry) => entry.value.trim().length > 0)
      .map((entry) => ({ otherClubName: entry.value.trim() })),
  ]);

  const initialJson =
    mode === "edit" && initialValues ? JSON.stringify(initialValues) : null;

  const isSubmitDisabled = (mode === "add" && isPublicValue === null) || isPending;
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
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-text">
          Clubs <span className="font-normal text-text-secondary">(optional)</span>
        </legend>
        <div className="flex flex-col gap-2 mt-1">
          {clubs.map((club) => (
            <label
              key={club.id}
              className="flex items-center gap-2.5 cursor-pointer text-sm text-text min-h-[44px]"
            >
              <input
                type="checkbox"
                checked={selectedClubIds.has(club.id)}
                onChange={() => toggleClub(club.id)}
                className="w-4 h-4 shrink-0 accent-button-primary-background"
              />
              {club.name}
            </label>
          ))}

          {/* Other */}
          <label className="flex items-center gap-2.5 cursor-pointer text-sm text-text min-h-[44px]">
            <input
              type="checkbox"
              checked={otherClubs.length > 0}
              onChange={(event) => toggleOther(event.target.checked)}
              className="w-4 h-4 shrink-0 accent-button-primary-background"
            />
            Other
          </label>

          {otherClubs.length > 0 && (
            <div className="ml-[26px] flex flex-col gap-2">
              {otherClubs.map((entry) => (
                <div key={entry.id} className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={entry.value}
                    onChange={(event) => updateOtherValue(entry.id, event.target.value)}
                    placeholder="Club name"
                    className="flex-1 h-10 px-3 rounded-lg border border-border bg-background text-text placeholder:text-text-secondary text-sm focus:outline-none focus:border-accent"
                  />
                  {otherClubs.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeOtherEntry(entry.id)}
                      aria-label="Remove this club"
                      className="text-sm text-text-secondary hover:text-danger px-2 min-h-[44px]"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addOtherEntry}
                className="text-sm text-link hover:text-link-hover self-start min-h-[44px]"
              >
                + Add another club
              </button>
            </div>
          )}
        </div>
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
