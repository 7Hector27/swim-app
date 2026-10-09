"use client";

import { useActionState } from "react";

import Button from "@/components/Button";

import { updateProfile } from "./actions";
import type { EditState } from "./actions";

function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return <p className="text-danger text-xs mt-1">{message}</p>;
}

const initialState: EditState = { status: "idle" };

interface EditProfileFormProps {
  initialFullName: string | null;
  initialPhone: string | null;
}

export default function EditProfileForm({ initialFullName, initialPhone }: EditProfileFormProps) {
  const [state, formAction, isPending] = useActionState(updateProfile, initialState);

  const fieldErrors = state.status === "field_errors" ? state.errors : {};

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      {state.status === "success" && (
        <p aria-live="polite" role="status" className="text-success text-sm">
          Changes saved.
        </p>
      )}
      {state.status === "error" && (
        <p aria-live="polite" className="text-danger text-sm">
          {state.message}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="fullName" className="text-sm font-semibold text-text">
          Full name
        </label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          required
          defaultValue={initialFullName ?? ""}
          className="h-12 px-4 rounded-lg border border-border bg-background text-text placeholder:text-text-secondary"
        />
        <FieldError message={fieldErrors["fullName"]} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="phone" className="text-sm font-semibold text-text">
          Phone{" "}
          <span className="font-normal text-text-secondary">(optional)</span>
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          defaultValue={initialPhone ?? ""}
          className="h-12 px-4 rounded-lg border border-border bg-background text-text placeholder:text-text-secondary"
        />
        <FieldError message={fieldErrors["phone"]} />
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving\u2026" : "Save changes"}
      </Button>
    </form>
  );
}
