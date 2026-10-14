"use client";

import { useState } from "react";

interface UndoToastProps {
  swimmer: { id: string; firstName: string };
  sessionId: string;
  accessToken: string;
  savedAt: number;
}

export default function UndoToast({ swimmer, sessionId, accessToken, savedAt }: UndoToastProps) {
  const [undoInProgress, setUndoInProgress] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);

  const UNDO_WINDOW_MS = 10 * 60 * 1000;
  const withinUndoWindow = Date.now() - savedAt < UNDO_WINDOW_MS;

  async function handleUndo() {
    setUndoInProgress(true);
    setUndoError(null);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/coach/sessions/${sessionId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      if (!response.ok) {
        setUndoError("Could not undo. The undo window may have passed.");
        setUndoInProgress(false);
        return;
      }
      window.location.href = `/coach/swimmers/${swimmer.id}`;
    } catch {
      setUndoError("Something went wrong. Please try again.");
      setUndoInProgress(false);
    }
  }

  if (!withinUndoWindow) return null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
        Need to undo? You can remove this evaluation within 10 minutes of saving.
      </p>
      {undoError && (
        <p role="alert" className="text-sm" style={{ color: "var(--color-danger)" }}>
          {undoError}
        </p>
      )}
      <button
        type="button"
        disabled={undoInProgress}
        onClick={() => { void handleUndo(); }}
        className="inline-flex items-center justify-center px-5 min-h-[44px] rounded border text-sm font-semibold"
        style={{
          borderColor: "var(--color-danger)",
          color: "var(--color-danger)",
          backgroundColor: "transparent",
          opacity: undoInProgress ? 0.6 : 1,
        }}
      >
        {undoInProgress ? "Undoing…" : "Undo this evaluation"}
      </button>
    </div>
  );
}
