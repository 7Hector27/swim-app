"use client";

import { useActionState, useState } from "react";
import { hideSwimmer } from "./actions";
import type { HideSwimmerState } from "./helpers";

interface HidePublicButtonProps {
  swimmerId: string;
  firstName: string;
}

const initialState: HideSwimmerState = { status: "idle" };

export default function HidePublicButton({ swimmerId, firstName }: HidePublicButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const boundAction = hideSwimmer.bind(null, swimmerId);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center justify-center rounded-button border border-danger text-danger font-bold text-sm px-5 min-h-[44px] transition-opacity hover:opacity-80 active:scale-[0.97]"
      >
        Hide from public
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text">
        Hide <strong>{firstName}</strong> from public leaderboards? This can be reversed later.
      </p>
      {state.status === "error" && (
        <p role="alert" aria-live="polite" className="text-danger text-sm">
          {state.message}
        </p>
      )}
      <div className="flex gap-3 flex-wrap">
        <form action={formAction}>
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center justify-center rounded-button bg-danger text-button-primary-text font-bold text-sm px-5 min-h-[44px] transition-opacity hover:opacity-80 active:scale-[0.97] disabled:opacity-50"
          >
            {isPending ? "Hiding…" : "Yes, hide"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="inline-flex items-center justify-center rounded-button border border-border text-text font-bold text-sm px-5 min-h-[44px] transition-opacity hover:opacity-80 active:scale-[0.97]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
