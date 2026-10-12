"use client";

import { useActionState } from "react";

import Button from "@/components/Button";
import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";
import type { InviteStatus } from "@swim-app/shared";

import { acceptInviteAction, type AcceptState } from "./actions";

interface InviteContentProps {
  status: InviteStatus | "not_found";
  householdName: string;
  token: string;
}

const initialState: AcceptState = { status: "idle" };

export default function InviteContent({ status, householdName, token }: InviteContentProps) {
  const boundAction = acceptInviteAction.bind(null, token);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  if (status !== "pending") {
    const messages: Record<string, string> = {
      not_found: "This invite link is not valid.",
      expired: "This invite link has expired.",
      revoked: "This invite link has been revoked.",
      accepted: "This invite link has already been used.",
    };

    return (
      <div className="flex flex-col min-h-screen">
        <SiteNav />
        <main className="flex-1 flex items-center justify-center px-page py-16">
          <div className="w-full max-w-sm text-center">
            <h1 className="text-heading mb-4">Invite unavailable</h1>
            <p className="text-text-secondary">{messages[status] ?? "This invite link is not valid."}</p>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const errorMessage = state.status === "error" ? state.error : null;

  return (
    <div className="flex flex-col min-h-screen">
      <SiteNav />
      <main className="flex-1 flex items-center justify-center px-page py-16">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-heading mb-2">Join the {householdName} household?</h1>
          <p className="text-text-secondary mb-8">
            You will be added as a viewer. The household owner can update your role later.
          </p>

          {errorMessage && (
            <p aria-live="polite" className="text-danger text-sm mb-4">
              {errorMessage}
            </p>
          )}

          <form action={formAction} className="flex flex-col gap-3">
            <Button type="submit" disabled={isPending} className="w-full">
              {isPending ? "Joining\u2026" : "Join household"}
            </Button>
          </form>

          <a
            href="/dashboard"
            className="block mt-3 text-sm text-text-secondary hover:text-text transition-colors duration-150"
          >
            Cancel
          </a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
