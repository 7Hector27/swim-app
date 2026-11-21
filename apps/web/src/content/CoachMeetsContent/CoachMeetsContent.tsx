"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Course, MeetResponse } from "@swim-app/shared";

import ConfirmDialog from "@/components/ConfirmDialog";
import { createMeet, deleteMeet } from "./actions";
import type { CreateMeetState, DeleteMeetState } from "./actions";

const COURSE_LABELS: Record<Course, string> = {
  scy: "SCY",
  scm: "SCM",
  lcm: "LCM",
};

interface CoachMeetsContentProps {
  meets: MeetResponse[];
}

// Inline create form. Every field is fully controlled by local state —
// nothing uses `defaultValue`. The post-submit form-reset behavior of
// `<form action={fn}>` in React 19 can only wipe uncontrolled fields,
// so controlled state is what makes the "an error never clears a field"
// rule hold.
function CreateMeetForm() {
  const [state, action, isPending] = useActionState<CreateMeetState, FormData>(createMeet, {
    status: "idle",
  });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [meetDate, setMeetDate] = useState("");
  const [course, setCourse] = useState<Course>("scy");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const didOpenRef = useRef(false);

  // Reset only when the user actually opens the form (false → true). Never
  // triggered by an error state transition; state stays put on failure.
  useEffect(() => {
    if (!open) {
      didOpenRef.current = false;
      return;
    }
    if (didOpenRef.current) return;
    didOpenRef.current = true;
    setName("");
    setMeetDate("");
    setCourse("scy");
  }, [open]);

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state.status]);

  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center px-5 min-h-[44px] font-bold text-sm rounded-button bg-button-primary-background text-button-primary-text"
      >
        Create meet
      </button>
    );
  }

  return (
    <form
      action={action}
      className="flex flex-col gap-4 p-5 rounded-card border border-border bg-background w-full"
    >
      <h2
        className="font-heading font-semibold text-lg text-heading"
        style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
      >
        New meet
      </h2>

      <div className="flex flex-col gap-1">
        <label htmlFor="meet-name" className="text-sm font-semibold text-text">
          Name
        </label>
        <input
          id="meet-name"
          name="name"
          type="text"
          required
          placeholder="e.g. Spring Invitational"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-11 px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring"
        />
      </div>

      <div className="flex flex-col gap-3 tablet:flex-row">
        <div className="flex flex-col gap-1 flex-1">
          <label htmlFor="meet-date" className="text-sm font-semibold text-text">
            Date
          </label>
          <input
            id="meet-date"
            name="meetDate"
            type="date"
            required
            value={meetDate}
            onChange={(event) => setMeetDate(event.target.value)}
            className="h-11 px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring"
          />
        </div>

        <div className="flex flex-col gap-1 flex-1">
          <label htmlFor="meet-course" className="text-sm font-semibold text-text">
            Course
          </label>
          <select
            id="meet-course"
            name="course"
            required
            value={course}
            onChange={(event) => setCourse(event.target.value as Course)}
            className="h-11 px-3 rounded-lg border border-border bg-background text-text text-base focus:outline focus:outline-2 focus:outline-focus-ring"
          >
            <option value="scy">SCY (Short Course Yards)</option>
            <option value="scm">SCM (Short Course Meters)</option>
            <option value="lcm">LCM (Long Course Meters)</option>
          </select>
        </div>
      </div>

      {state.status === "error" && (
        <p
          ref={errorRef}
          role="alert"
          aria-live="assertive"
          tabIndex={-1}
          style={{ outline: "none" }}
          className="text-sm text-danger"
        >
          {state.message}
        </p>
      )}

      <div className="flex flex-col gap-2 tablet:flex-row tablet:gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center px-5 min-h-[44px] font-bold text-sm rounded-button disabled:opacity-60 bg-button-primary-background text-button-primary-text w-full tablet:w-auto"
        >
          {isPending ? "Creating…" : "Create meet"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex items-center justify-center px-5 min-h-[44px] font-semibold text-sm rounded-button border border-button-outline text-button-outline w-full tablet:w-auto"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function MeetRow({ meet }: { meet: MeetResponse }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [deleteState, deleteAction, isDeleting] = useActionState<DeleteMeetState, FormData>(
    deleteMeet.bind(null, meet.id),
    { status: "idle" },
  );

  function openDialog() {
    dialogRef.current?.showModal();
  }
  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <li className="flex items-center justify-between gap-3 py-3 border-t border-border first:border-t-0">
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <Link
          href={`/coach/meets/${meet.id}`}
          className="font-semibold text-text text-sm hover:text-link truncate"
        >
          {meet.name}
        </Link>
        <p className="text-xs text-text-secondary">
          {meet.meetDate} · {COURSE_LABELS[meet.course]}
          {meet.swimCount > 0 && ` · ${meet.swimCount} result${meet.swimCount === 1 ? "" : "s"}`}
        </p>
      </div>

      <form id={`delete-meet-${meet.id}`} action={deleteAction} className="hidden" />
      <button
        type="button"
        onClick={openDialog}
        className="text-xs font-semibold text-danger hover:opacity-80 min-h-[44px] px-2 shrink-0"
      >
        Delete
      </button>

      {deleteState.status === "error" && (
        <p role="alert" className="text-xs text-danger mt-1">
          {deleteState.message}
        </p>
      )}

      <ConfirmDialog
        dialogRef={dialogRef}
        title="Delete meet?"
        description={
          meet.swimCount > 0
            ? `"${meet.name}" and its ${meet.swimCount} recorded result${meet.swimCount === 1 ? "" : "s"} will be permanently deleted.`
            : `"${meet.name}" will be permanently deleted.`
        }
        formId={`delete-meet-${meet.id}`}
        confirmLabel="Delete"
        confirmDanger
        isPending={isDeleting}
        {...(deleteState.status === "error" && { errorMessage: deleteState.message })}
        onCancel={closeDialog}
      />
    </li>
  );
}

export default function CoachMeetsContent({ meets }: CoachMeetsContentProps) {
  // Newest first.
  const sorted = [...meets].sort((a, b) => b.meetDate.localeCompare(a.meetDate));

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 px-page py-16">
        <div className="mx-auto max-w-content flex flex-col gap-8">
          <div className="flex flex-col gap-4 tablet:flex-row tablet:items-start tablet:justify-between">
            <h1
              className="text-heading font-heading font-semibold"
              style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
            >
              Meets
            </h1>
            <CreateMeetForm />
          </div>

          {sorted.length === 0 ? (
            <p className="text-sm text-text-secondary">
              No meets yet. Create one to start recording results.
            </p>
          ) : (
            <ul className="flex flex-col">
              {sorted.map((meet) => (
                <MeetRow key={meet.id} meet={meet} />
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
