"use client";

import { useActionState, useMemo } from "react";

import type { Club, HouseholdRole, ParentSwimmer } from "@swim-app/shared";

import PublicToggleSection from "@/components/PublicToggleSection";
import SwimmerForm from "@/components/SwimmerForm";

import { editSwimmer } from "./actions";
import { toClubInputs } from "./helpers";
import type { EditSwimmerState } from "./helpers";

const initialState: EditSwimmerState = { status: "idle" };

interface EditSwimmerContentProps {
  swimmer: ParentSwimmer;
  householdRole: HouseholdRole;
  clubs: Club[];
}

export default function EditSwimmerContent({
  swimmer,
  householdRole,
  clubs,
}: EditSwimmerContentProps) {
  const boundEditSwimmer = useMemo(() => editSwimmer.bind(null, swimmer.id), [swimmer.id]);
  const [state, formAction, isPending] = useActionState(boundEditSwimmer, initialState);

  const initialValues = {
    firstName: swimmer.firstName,
    lastName: swimmer.lastName,
    birthDate: swimmer.birthDate,
    sex: swimmer.sex,
    isPublic: swimmer.isPublic,
    clubs: toClubInputs(swimmer.clubs),
  };

  const canEdit = householdRole === "owner" || householdRole === "manager";

  const formState =
    state.status === "idle" || state.status === "no_changes"
      ? ({ status: "idle" } as const)
      : state;

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 px-page py-12 tablet:py-16">
        <div className="mx-auto max-w-md flex flex-col gap-10">
          <a
            href="/dashboard"
            className="inline-flex items-center gap-1 text-sm text-link hover:text-link-hover"
          >
            ← Dashboard
          </a>

          <div>
            <h1 className="text-heading mb-2">Edit swimmer</h1>
            <p className="text-text-secondary mb-8">
              {swimmer.firstName} {swimmer.lastName}
            </p>

            {state.status === "no_changes" && (
              <p aria-live="polite" className="text-text-secondary text-sm mb-4">
                No changes to save.
              </p>
            )}

            {canEdit ? (
              <SwimmerForm
                clubs={clubs}
                formAction={formAction}
                state={formState}
                isPending={isPending}
                mode="edit"
                swimmerId={swimmer.id}
                initialValues={initialValues}
                hidePublicSection
              />
            ) : (
              <p className="text-sm text-text-secondary">
                You have view-only access to this household. Contact the owner or manager to
                make changes.
              </p>
            )}
          </div>

          <PublicToggleSection
            swimmerId={swimmer.id}
            isPublic={swimmer.isPublic}
            householdRole={householdRole}
            swimmerFirstName={swimmer.firstName}
          />
        </div>
      </main>
    </div>
  );
}
