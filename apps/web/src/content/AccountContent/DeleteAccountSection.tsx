"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";

import type { DeletionPreviewResponse } from "@swim-app/shared";
import {
  DELETION_CONFIRMATION_PHRASE,
  matchesDeletionConfirmationPhrase,
} from "@swim-app/shared";

import Button from "@/components/Button";

import { confirmDeletionAction } from "./deleteAccountActions";
import {
  classifyDeleteAccountCase,
  formatRetryAfterMinutes,
  initialDeleteAccountState,
  type DeleteAccountCase,
} from "./deleteAccountHelpers";

interface DeleteAccountSectionProps {
  // Pre-fetched at /account server load. Null when the API call failed
  // or returned a non-200 — the section still renders a short message
  // so a transient preview failure doesn't silently remove the entry
  // point, but no confirm form.
  preview: DeletionPreviewResponse | null;
}

export default function DeleteAccountSection({ preview }: DeleteAccountSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [state, formAction, isPending] = useActionState(
    confirmDeletionAction,
    initialDeleteAccountState,
  );

  const passwordId = useId();
  const phraseId = useId();
  const sectionHeadingId = useId();

  // iPhone autocapitalizes the first word (autoCapitalize="none" on the
  // input mitigates it but older iOS versions ignore it on some fields),
  // so compare normalized rather than strict ===. The server does the
  // same via matchesDeletionConfirmationPhrase; keeping the client +
  // server rules in lockstep avoids a "button says ok, server says 422"
  // divergence. Trailing whitespace from autocomplete fat-fingers is
  // also forgiven.
  const phraseMatches = matchesDeletionConfirmationPhrase(confirmationPhrase);

  if (preview === null) {
    return (
      <section
        aria-labelledby={sectionHeadingId}
        className="flex flex-col gap-3 rounded-card border-2 border-danger p-5 scroll-mt-[calc(var(--header-height)+1rem)]"
      >
        <h2
          id={sectionHeadingId}
          className="font-heading text-xl text-danger"
          style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
        >
          Delete account
        </h2>
        <p className="text-sm text-text-secondary">
          We couldn&apos;t load your deletion preview right now. Reload the page or try again
          later.
        </p>
      </section>
    );
  }

  const deletionCase = classifyDeleteAccountCase(preview);

  return (
    <section
      aria-labelledby={sectionHeadingId}
      data-testid="delete-account-section"
      className="flex flex-col gap-4 rounded-card border-2 border-danger p-5 scroll-mt-[calc(var(--header-height)+1rem)]"
    >
      <h2
        id={sectionHeadingId}
        className="font-heading text-xl text-danger"
        style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
      >
        Delete account
      </h2>

      <p className="text-sm text-text-secondary">
        Permanently close this account. This cannot be undone.
      </p>

      {!expanded && (
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setExpanded(true)}
            data-testid="delete-account-expand"
          >
            Delete account
          </Button>
        </div>
      )}

      {expanded && (
        <>
          <div className="border-t border-border" aria-hidden="true" />
          <DeletionPreviewCopy preview={preview} deletionCase={deletionCase} />

          {deletionCase === "blocked_owner_must_transfer" ? (
            <BlockedOwnerPanel />
          ) : (
            <ConfirmForm
              formAction={formAction}
              state={state}
              isPending={isPending}
              passwordId={passwordId}
              phraseId={phraseId}
              confirmationPhrase={confirmationPhrase}
              onPhraseChange={setConfirmationPhrase}
              phraseMatches={phraseMatches}
              onCancel={() => {
                setExpanded(false);
                setConfirmationPhrase("");
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

// ── Preview copy per case ────────────────────────────────────────────────────

function DeletionPreviewCopy({
  preview,
  deletionCase,
}: {
  preview: DeletionPreviewResponse;
  deletionCase: DeleteAccountCase;
}) {
  const swimmerNames = preview.swimmers
    .map((swimmer) => `${swimmer.firstName} ${swimmer.lastInitial}`.trim())
    .filter((name) => name.length > 0)
    .join(", ");

  return (
    <div className="flex flex-col gap-3 text-sm text-text" data-testid="delete-account-preview">
      {deletionCase === "solo_alone" && (
        <>
          <p>
            You&apos;re the only person on <strong>{preview.householdName || "this account"}</strong>.
            Deleting your account will also remove:
          </p>
          <ul className="list-disc pl-5 text-text-secondary">
            {preview.swimmers.length > 0 && (
              <li data-testid="delete-account-preview-swimmers">
                Swimmer{preview.swimmers.length === 1 ? "" : "s"}:{" "}
                <span className="text-text">{swimmerNames}</span>
              </li>
            )}
            <li>All evaluations and meet times for {preview.swimmers.length === 1 ? "this swimmer" : "these swimmers"}</li>
            {preview.futureLessonCount > 0 && (
              <li data-testid="delete-account-preview-future">
                {preview.futureLessonCount} upcoming lesson
                {preview.futureLessonCount === 1 ? "" : "s"} (cancelled, Coach Jason is notified)
              </li>
            )}
            <li>Your household and home pool address</li>
          </ul>
          <p className="text-text-secondary" data-testid="delete-account-preview-kept">
            Past lessons stay on Coach Jason&apos;s records with no names attached.
            {preview.pastLessonCount > 0
              ? ` (${preview.pastLessonCount} past lesson${preview.pastLessonCount === 1 ? "" : "s"} will be kept this way.)`
              : ""}
          </p>
        </>
      )}

      {deletionCase === "solo_owner_with_viewers" && (
        <>
          <p>
            You own <strong>{preview.householdName || "this household"}</strong>, and the other
            members on it are viewers only. Deleting your account will also remove:
          </p>
          <ul className="list-disc pl-5 text-text-secondary">
            {preview.swimmers.length > 0 && (
              <li>
                Swimmer{preview.swimmers.length === 1 ? "" : "s"}:{" "}
                <span className="text-text">{swimmerNames}</span>
              </li>
            )}
            <li>All evaluations and meet times</li>
            {preview.futureLessonCount > 0 && (
              <li>
                {preview.futureLessonCount} upcoming lesson
                {preview.futureLessonCount === 1 ? "" : "s"} (cancelled, Coach Jason is notified)
              </li>
            )}
            <li>The household and home pool address</li>
          </ul>
          <p className="text-text-secondary">
            The viewers on this household stay signed in; they&apos;ll be released from{" "}
            {preview.householdName || "this household"} and can be invited to another one.
          </p>
          <p className="text-text-secondary">
            Past lessons stay on Coach Jason&apos;s records with no names attached.
          </p>
        </>
      )}

      {deletionCase === "leave" && (
        <>
          <p>
            You&apos;ll be removed from <strong>{preview.householdName || "this household"}</strong>.
            Your account is closed; the household, its swimmers, and the other members all stay.
          </p>
          <p className="text-text-secondary">
            Your name and contact info are scrubbed from the household&apos;s records. Past
            lessons you booked stay on Coach Jason&apos;s records with no names attached.
          </p>
        </>
      )}
    </div>
  );
}

// ── Blocked panel (owner with adults) ────────────────────────────────────────

function BlockedOwnerPanel() {
  return (
    <div
      className="flex flex-col gap-3 rounded-card border border-divider-section bg-surface-soft p-4 text-sm"
      data-testid="delete-account-blocked"
    >
      <p className="text-text">
        You&apos;re the owner of this household, and there&apos;s another adult on it. You need to
        transfer ownership before you can close your account.
      </p>
      <p className="text-text-secondary">
        Go to the household page to pick the new owner, then come back here to delete your
        account.
      </p>
      <div>
        <Link
          href="/household"
          className="inline-flex items-center justify-center rounded-button font-bold text-sm min-h-[52px] px-7 border-2 border-button-outline text-button-outline"
          data-testid="delete-account-transfer-link"
        >
          Go to household settings
        </Link>
      </div>
    </div>
  );
}

// ── Confirm form (password + typed phrase) ───────────────────────────────────

interface ConfirmFormProps {
  formAction: (formData: FormData) => void;
  state: Awaited<ReturnType<typeof confirmDeletionAction>>;
  isPending: boolean;
  passwordId: string;
  phraseId: string;
  confirmationPhrase: string;
  onPhraseChange: (next: string) => void;
  phraseMatches: boolean;
  onCancel: () => void;
}

function ConfirmForm({
  formAction,
  state,
  isPending,
  passwordId,
  phraseId,
  confirmationPhrase,
  onPhraseChange,
  phraseMatches,
  onCancel,
}: ConfirmFormProps) {
  const disabled = !phraseMatches || isPending;

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={passwordId} className="text-sm font-semibold text-text">
          Your password
        </label>
        <input
          id={passwordId}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-12 px-4 rounded-lg border border-border bg-background text-text placeholder:text-text-secondary"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={phraseId} className="text-sm font-semibold text-text">
          Type <span className="font-mono text-text">{DELETION_CONFIRMATION_PHRASE}</span>{" "}
          to confirm
        </label>
        <input
          id={phraseId}
          name="confirmationPhrase"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={confirmationPhrase}
          onChange={(event) => onPhraseChange(event.target.value)}
          data-testid="delete-account-phrase-input"
          className="h-12 px-4 rounded-lg border border-border bg-background text-text placeholder:text-text-secondary"
        />
      </div>

      <InlineStatus state={state} />

      <div className="flex flex-col gap-3 tablet:flex-row tablet:items-center">
        <Button
          type="submit"
          disabled={disabled}
          data-testid="delete-account-confirm-button"
          className="bg-danger text-button-primary-text"
        >
          {isPending ? "Deleting\u2026" : "Delete my account"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isPending}
          data-testid="delete-account-cancel"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function InlineStatus({ state }: { state: Awaited<ReturnType<typeof confirmDeletionAction>> }) {
  if (state.status === "idle") return null;

  if (state.status === "invalid_password") {
    return (
      <p
        aria-live="polite"
        className="text-danger text-sm"
        data-testid="delete-account-error-invalid-password"
      >
        That password didn&apos;t match. Try again.
      </p>
    );
  }
  if (state.status === "rate_limited") {
    return (
      <p
        aria-live="polite"
        className="text-danger text-sm"
        data-testid="delete-account-error-rate-limited"
      >
        Too many attempts. Try again {formatRetryAfterMinutes(state.retryAfterSeconds)}.
      </p>
    );
  }
  if (state.status === "must_transfer_first") {
    return (
      <p
        aria-live="polite"
        className="text-danger text-sm"
        data-testid="delete-account-error-must-transfer"
      >
        Another adult joined this household while you had this page open. Transfer ownership
        first before deleting.
      </p>
    );
  }
  if (state.status === "already_deleted") {
    return (
      <p aria-live="polite" className="text-danger text-sm">
        This account is already closed. Refresh the page to sign out.
      </p>
    );
  }
  if (state.status === "phrase_mismatch") {
    return (
      <p aria-live="polite" className="text-danger text-sm">
        Type the phrase exactly — {DELETION_CONFIRMATION_PHRASE} — to confirm.
      </p>
    );
  }
  if (state.status === "missing_fields") {
    return (
      <p aria-live="polite" className="text-danger text-sm">
        Enter your password and type the confirmation phrase.
      </p>
    );
  }
  return (
    <p
      aria-live="polite"
      className="text-danger text-sm"
      data-testid="delete-account-error-generic"
    >
      Something went wrong. Try again in a moment.
    </p>
  );
}
