"use client";

import { useActionState } from "react";

import { renameHouseholdAction } from "./actions";

interface Props {
  name: string;
  isOwner: boolean;
}

export default function RenameForm({ name, isOwner }: Props) {
  const [state, formAction, isPending] = useActionState(renameHouseholdAction, { status: "idle" });

  if (!isOwner) {
    return <p className="text-sm text-text">{name}</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex gap-3 items-start">
        <div className="flex-1">
          <label htmlFor="household-name" className="sr-only">
            Household name
          </label>
          <input
            id="household-name"
            name="name"
            type="text"
            defaultValue={name}
            maxLength={50}
            required
            className="w-full rounded-button border border-border bg-background text-text text-sm px-4 h-11 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors duration-150"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm px-5 h-11 transition-opacity hover:opacity-90 disabled:opacity-60 flex-shrink-0"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      </div>

      {state.status === "error" && (
        <p role="alert" aria-live="polite" className="text-sm text-danger">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" aria-live="polite" className="text-sm text-success">
          Name updated.
        </p>
      )}
    </form>
  );
}
