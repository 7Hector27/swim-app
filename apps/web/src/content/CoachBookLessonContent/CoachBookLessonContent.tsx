"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  CoachBookingWarnings,
  CoachHouseholdSearchResult,
  LessonLocation,
} from "@swim-app/shared";

import Step1HouseholdPicker from "./Step1HouseholdPicker";
import Step2TimePicker from "./Step2TimePicker";
import Step3Success from "./Step3Success";
import ConfirmBookingDialog, {
  type ConfirmSummary,
} from "./ConfirmBookingDialog";
import { submitCoachBookingAction } from "./actions";
import { type BookingStep } from "./helpers";

interface Props {
  initialHousehold: CoachHouseholdSearchResult | null;
  initialSwimmerIds: string[];
  namedPools: LessonLocation[];
  // Server config value threaded through to the confirmation dialog so the
  // max-advance warning string stays in sync with the real limit.
  bookingMaxAdvanceWeeks: number;
}

interface PendingBooking {
  summary: ConfirmSummary;
  swimmerIds: string[];
  householdId: string;
  locationId: string;
  // When overrideWindow is true the dialog expects the server to compute
  // warnings on first attempt; the client's checkboxes track acknowledgement.
  overrideWindow: boolean;
}

interface SuccessState {
  lessonId: string;
  startsAtUtc: string;
  durationMinutes: 30 | 45 | 60;
  locationName: string;
  householdName: string;
  swimmerFirstNames: string[];
}

export default function CoachBookLessonContent({
  initialHousehold,
  initialSwimmerIds,
  namedPools,
  bookingMaxAdvanceWeeks,
}: Props) {
  // Pre-fill: when entering from /coach/swimmers/[id], step 1 is skipped
  // and we go directly to step 2 with the household + swimmer selected.
  const [step, setStep] = useState<BookingStep>(
    initialHousehold !== null && initialSwimmerIds.length > 0 ? "pickTime" : "pickHousehold",
  );
  const [household, setHousehold] = useState<CoachHouseholdSearchResult | null>(
    initialHousehold,
  );
  const [swimmerIds, setSwimmerIds] = useState<string[]>(initialSwimmerIds);
  const [pending, setPending] = useState<PendingBooking | null>(null);
  const [serverWarnings, setServerWarnings] = useState<CoachBookingWarnings | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  function handleSelectHousehold(next: CoachHouseholdSearchResult) {
    setHousehold(next);
    // Reset swimmers if the user switched to a different household.
    if (household?.householdId !== next.householdId) {
      setSwimmerIds([]);
    }
  }

  function handleToggleSwimmer(swimmerId: string) {
    setSwimmerIds((prev) => {
      if (prev.includes(swimmerId)) {
        return prev.filter((id) => id !== swimmerId);
      }
      if (prev.length >= 4) return prev;
      return [...prev, swimmerId];
    });
  }

  function handleContinueToStep2() {
    if (household && swimmerIds.length > 0) {
      setStep("pickTime");
    }
  }

  function handleBackToStep1() {
    setStep("pickHousehold");
  }

  const swimmerFirstNames = useMemo(() => {
    if (!household) return [];
    return swimmerIds
      .map((id) => household.swimmers.find((swimmer) => swimmer.id === id)?.firstName ?? null)
      .filter((name): name is string => name !== null);
  }, [household, swimmerIds]);

  function handleStartConfirm(args: {
    startsAtUtc: string;
    durationMinutes: 30 | 45 | 60;
    locationId: string;
    locationName: string;
    overrideWindow: boolean;
  }) {
    if (!household) return;
    setPending({
      summary: {
        householdName: household.householdName,
        swimmerFirstNames,
        locationName: args.locationName,
        startsAtUtc: args.startsAtUtc,
        durationMinutes: args.durationMinutes,
        overrideWindow: args.overrideWindow,
      },
      swimmerIds,
      householdId: household.householdId,
      locationId: args.locationId,
      overrideWindow: args.overrideWindow,
    });
    setServerWarnings(null);
    setSubmitError(null);
  }

  async function submitBooking(acknowledgedWarnings: CoachBookingWarnings) {
    if (!pending) return;
    setIsSubmitting(true);
    setSubmitError(null);
    const result = await submitCoachBookingAction({
      householdId: pending.householdId,
      swimmerIds: pending.swimmerIds,
      locationId: pending.locationId,
      startsAt: pending.summary.startsAtUtc,
      durationMinutes: pending.summary.durationMinutes,
      overrideWindow: pending.overrideWindow || serverWarnings !== null,
      acknowledgedWarnings,
    });
    setIsSubmitting(false);

    if (result.kind === "created") {
      setSuccess({
        lessonId: result.lesson.id,
        startsAtUtc: result.lesson.startsAt,
        durationMinutes: result.lesson.durationMinutes,
        locationName: pending.summary.locationName,
        householdName: pending.summary.householdName,
        swimmerFirstNames,
      });
      setPending(null);
      setStep("success");
      return;
    }
    if (result.kind === "warnings") {
      // Server surfaced one or more warnings. Keep the dialog open and show
      // the acknowledge list.
      setServerWarnings(result.body.warnings);
      // Flip overrideWindow on so the next submit includes the full ack set.
      setPending((prev) =>
        prev ? { ...prev, overrideWindow: true } : prev,
      );
      return;
    }
    if (result.kind === "slot_unavailable") {
      setSubmitError(
        "That time isn't available anymore. Pick another one.",
      );
      return;
    }
    setSubmitError(result.message);
  }

  function handleCancelConfirm() {
    setPending(null);
    setServerWarnings(null);
    setSubmitError(null);
  }

  if (success !== null) {
    return <Step3Success {...success} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link
          href="/coach/schedule"
          className="text-sm text-link underline hover:text-link-hover"
        >
          ← Schedule
        </Link>
      </div>
      <h1 className="font-heading text-3xl tablet:text-4xl text-heading">
        Book a lesson
      </h1>

      {step === "pickHousehold" && (
        <Step1HouseholdPicker
          initialHouseholds={household ? [household] : []}
          selectedHousehold={household}
          selectedSwimmerIds={swimmerIds}
          onSelectHousehold={handleSelectHousehold}
          onToggleSwimmer={handleToggleSwimmer}
          onContinue={handleContinueToStep2}
        />
      )}

      {step === "pickTime" && household && (
        <Step2TimePicker
          household={household}
          swimmerIds={swimmerIds}
          namedPools={namedPools}
          onConfirm={handleStartConfirm}
          onBack={handleBackToStep1}
        />
      )}

      {pending !== null && (
        <ConfirmBookingDialog
          open={true}
          summary={pending.summary}
          warnings={serverWarnings}
          bookingMaxAdvanceWeeks={bookingMaxAdvanceWeeks}
          isSubmitting={isSubmitting}
          errorMessage={submitError}
          onCancel={handleCancelConfirm}
          onSubmit={(acknowledgedWarnings) => submitBooking(acknowledgedWarnings)}
        />
      )}
    </div>
  );
}

