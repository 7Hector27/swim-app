"use client";

import { useActionState, useState } from "react";

import type { Club } from "@swim-app/shared";

import Button from "@/components/Button";
import FieldError from "@/components/FieldError";
import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";

import { addSwimmer } from "./actions";
import type { AddSwimmerState } from "./helpers";

const initialState: AddSwimmerState = { status: "idle" };

interface AddSwimmerContentProps {
  clubs: Club[];
}

export default function AddSwimmerContent({ clubs }: AddSwimmerContentProps) {
  const [state, formAction, isPending] = useActionState(addSwimmer, initialState);
  const [selectedClubIds, setSelectedClubIds] = useState<Set<string>>(new Set());
  const [otherClubNames, setOtherClubNames] = useState<string[]>([]);
  const [isPublicValue, setIsPublicValue] = useState<"yes" | "no" | null>(null);

  const fieldErrors = state.status === "field_errors" ? state.errors : {};
  const topError = state.status === "error" ? state.message : null;

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
    setOtherClubNames(checked ? [""] : []);
  }

  function updateOtherName(index: number, value: string) {
    setOtherClubNames((prev) => prev.map((name, i) => (i === index ? value : name)));
  }

  function removeOtherName(index: number) {
    setOtherClubNames((prev) => prev.filter((_, i) => i !== index));
  }

  const clubsJson = JSON.stringify([
    ...[...selectedClubIds].map((id) => ({ clubId: id })),
    ...otherClubNames
      .filter((name) => name.trim().length > 0)
      .map((name) => ({ otherClubName: name.trim() })),
  ]);

  const inputClass =
    "h-12 px-4 rounded-lg border border-border bg-background text-text placeholder:text-text-secondary focus:outline-none focus:border-accent";

  return (
    <div className="flex flex-col min-h-screen">
      <SiteNav />
      <main className="flex-1 px-page py-12 tablet:py-16">
        <div className="mx-auto max-w-md">
          <a
            href="/dashboard"
            className="inline-flex items-center gap-1 text-sm text-link hover:text-link-hover mb-6"
          >
            ← Dashboard
          </a>

          <h1 className="text-heading mb-2">Add a swimmer</h1>
          <p className="text-text-secondary mb-8">Enter your swimmer's details below.</p>

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
                aria-describedby={fieldErrors["birthDate"] ? "birthDate-error" : undefined}
                className={inputClass}
              />
              <FieldError id="birthDate-error" message={fieldErrors["birthDate"]} />
            </div>

            {/* Competition category */}
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-semibold text-text">
                Competition category
              </legend>
              <p className="text-xs text-text-secondary mt-0.5">
                Used to place your swimmer in the correct age group.
              </p>
              <div className="flex gap-6 mt-1">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-text min-h-[44px]">
                  <input
                    type="radio"
                    name="sex"
                    value="female"
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
                Clubs{" "}
                <span className="font-normal text-text-secondary">(optional)</span>
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
                    checked={otherClubNames.length > 0}
                    onChange={(event) => toggleOther(event.target.checked)}
                    className="w-4 h-4 shrink-0 accent-button-primary-background"
                  />
                  Other
                </label>

                {otherClubNames.length > 0 && (
                  <div className="ml-[26px] flex flex-col gap-2">
                    {otherClubNames.map((name, index) => (
                      <div key={index} className="flex gap-2 items-center">
                        <input
                          type="text"
                          value={name}
                          onChange={(event) => updateOtherName(index, event.target.value)}
                          placeholder="Club name"
                          className="flex-1 h-10 px-3 rounded-lg border border-border bg-background text-text placeholder:text-text-secondary text-sm focus:outline-none focus:border-accent"
                        />
                        {otherClubNames.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeOtherName(index)}
                            aria-label={`Remove club ${index + 1}`}
                            className="text-sm text-text-secondary hover:text-danger px-2 min-h-[44px]"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setOtherClubNames((prev) => [...prev, ""])}
                      className="text-sm text-link hover:text-link-hover self-start"
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
              <legend className="text-sm font-semibold text-text">
                Public leaderboards
              </legend>
              <p className="text-xs text-text-secondary mt-0.5">
                Choosing Yes shows your swimmer's first name and last initial, times, and
                level on the public leaderboard. Swim progress is tracked either way — this
                setting only affects what others can see.
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
              {isPublicValue === null && (
                <p className="text-text-secondary text-xs">
                  Please select Yes or No to continue.
                </p>
              )}
              <FieldError id="isPublic-error" message={fieldErrors["isPublic"]} />
            </fieldset>

            <input type="hidden" name="clubsJson" value={clubsJson} />

            <Button
              type="submit"
              disabled={isPublicValue === null || isPending}
              className="w-full mt-2"
            >
              {isPending ? "Adding swimmer…" : "Add swimmer"}
            </Button>
          </form>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
