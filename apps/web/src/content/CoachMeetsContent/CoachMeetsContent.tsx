"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { MeetResponse } from "@swim-app/shared";

import ConfirmDialog from "@/components/ConfirmDialog";
import { createMeet, deleteMeet } from "./actions";
import type { CreateMeetState, DeleteMeetState } from "./actions";

const COURSE_LABELS: Record<string, string> = {
  scy: "SCY",
  scm: "SCM",
  lcm: "LCM",
};

interface CoachMeetsContentProps {
  meets: MeetResponse[];
}

function CreateMeetForm() {
  const [state, action, isPending] = useActionState<CreateMeetState, FormData>(createMeet, {
    status: "idle",
  });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [meetDate, setMeetDate] = useState("");
  const [course, setCourse] = useState("scy");
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      setOpen(false);
    }
  }, [state.status]);

  useEffect(() => {
    if (open) {
      setName("");
      setMeetDate("");
      setCourse("scy");
    }
  }, [open]);

  useEffect(() => {
    if (state.status === "error") {
      errorRef.current?.focus();
    }
  }, [state]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center px-5 min-h-[44px] font-bold text-sm rounded-button"
        style={{
          backgroundColor: "var(--color-button-primary-background)",
          color: "var(--color-button-primary-text)",
        }}
      >
        Create meet
      </button>
    );
  }

  return (
    <form
      action={action}
      className="flex flex-col gap-4 p-5 rounded-card border border-border bg-background"
    >
      <h2 className="font-heading font-semibold text-lg text-heading" style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}>
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
          onChange={(e) => setName(e.target.value)}
          className="h-11 px-3 rounded-lg border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="meet-date" className="text-sm font-semibold text-text">
          Date
        </label>
        <input
          id="meet-date"
          name="meetDate"
          type="date"
          required
          value={meetDate}
          onChange={(e) => setMeetDate(e.target.value)}
          className="h-11 px-3 rounded-lg border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="meet-course" className="text-sm font-semibold text-text">
          Course
        </label>
        <select
          id="meet-course"
          name="course"
          required
          value={course}
          onChange={(e) => setCourse(e.target.value)}
          className="h-11 px-3 rounded-lg border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
        >
          <option value="scy">SCY (Short Course Yards)</option>
          <option value="scm">SCM (Short Course Meters)</option>
          <option value="lcm">LCM (Long Course Meters)</option>
        </select>
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

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center px-5 min-h-[44px] font-bold text-sm rounded-button disabled:opacity-60"
          style={{
            backgroundColor: "var(--color-button-primary-background)",
            color: "var(--color-button-primary-text)",
          }}
        >
          {isPending ? "Creating…" : "Create meet"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex items-center justify-center px-5 min-h-[44px] font-semibold text-sm rounded-button border"
          style={{
            borderColor: "var(--color-button-outline)",
            color: "var(--color-button-outline)",
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

interface MeetRowProps {
  meet: MeetResponse;
}

function MeetRow({ meet }: MeetRowProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
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
      <div className="flex flex-col gap-0.5 min-w-0">
        <Link
          href={`/coach/meets/${meet.id}`}
          className="font-semibold text-text text-sm hover:text-link truncate"
        >
          {meet.name}
        </Link>
        <p className="text-xs text-text-secondary">
          {meet.meetDate} · {COURSE_LABELS[meet.course] ?? meet.course}
          {meet.swimCount > 0 && ` · ${meet.swimCount} swim${meet.swimCount === 1 ? "" : "s"}`}
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <form ref={formRef} id={`delete-meet-${meet.id}`} action={deleteAction} className="hidden" />
        <button
          type="button"
          onClick={openDialog}
          className="text-xs font-semibold text-danger hover:opacity-80 min-h-[44px] px-2"
        >
          Delete
        </button>
      </div>

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
            ? `"${meet.name}" and its ${meet.swimCount} recorded swim${meet.swimCount === 1 ? "" : "s"} will be permanently deleted.`
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
  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 px-page py-16">
        <div className="mx-auto max-w-content flex flex-col gap-8">
          <h1 className="text-heading font-heading font-semibold" style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}>
            Meets
          </h1>

          <CreateMeetForm />

          {meets.length === 0 ? (
            <p className="text-sm text-text-secondary">No meets yet. Create one to get started.</p>
          ) : (
            <ul className="flex flex-col">
              {meets.map((meet) => (
                <MeetRow key={meet.id} meet={meet} />
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
