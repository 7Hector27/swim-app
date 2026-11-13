"use client";

import { useState, useTransition } from "react";

import type { MissingPolicyAcceptancesResponse } from "@swim-app/shared";
import { isSafeReturnTo } from "@swim-app/shared";

import Button from "@/components/Button";

import { acceptPoliciesAction } from "./actions";

type Missing = MissingPolicyAcceptancesResponse["missing"];

interface Props {
  missing: Missing;
  next: string;
  siteUrl: string;
}

// Short, human-safe label + link target for each policy slug. Any
// slug added to the backend enum shows up here too so the
// interstitial always has something to render.
const POLICY_LABELS: Record<string, { label: string; href: string }> = {
  terms: { label: "Terms of Service", href: "/terms" },
  privacy: { label: "Privacy Policy", href: "/privacy" },
  payments_refund: {
    label: "Payments & Refund Policy",
    href: "/refund-policy",
  },
};

export default function PolicyUpdatedContent({ missing, next, siteUrl }: Props) {
  const [checked, setChecked] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAccept() {
    if (!checked || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await acceptPoliciesAction();
      if (result.status === "ok") {
        const safeNext = isSafeReturnTo(next, siteUrl) ? next : "/dashboard";
        window.location.href = safeNext;
        return;
      }
      setError("We couldn't record your acceptance. Please try again.");
    });
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-[640px] px-4 py-10 tablet:py-16">
        <h1 className="font-heading text-[2rem] tablet:text-[2.5rem] leading-tight text-text mb-4">
          We&apos;ve updated our policies
        </h1>
        <p className="font-body text-base text-text-secondary mb-8">
          Please review and accept the following before continuing:
        </p>

        <ul className="flex flex-col gap-3 mb-8" data-testid="policy-updated-list">
          {missing.map((row) => {
            const meta = POLICY_LABELS[row.policySlug] ?? {
              label: row.policySlug,
              href: "#",
            };
            return (
              <li
                key={row.policySlug}
                className="rounded-card border border-border bg-background p-4"
                data-testid={`policy-updated-item-${row.policySlug}`}
              >
                <p className="font-body text-sm font-semibold text-text">
                  <a
                    href={meta.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link underline hover:text-link-hover"
                  >
                    {meta.label}
                  </a>
                </p>
                <p className="font-body text-xs text-text-secondary mt-1">
                  New version {row.currentVersion}
                  {row.lastAcceptedVersion
                    ? ` (you previously accepted ${row.lastAcceptedVersion})`
                    : " (you haven't accepted a version yet)"}
                </p>
              </li>
            );
          })}
        </ul>

        <label className="flex items-start gap-3 mb-6 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
            className="mt-0.5 w-4 h-4 shrink-0 accent-button-primary-background"
            data-testid="policy-updated-checkbox"
          />
          <span className="font-body text-sm text-text">
            I&apos;ve read and agree to the updated{" "}
            {missing
              .map((row) => POLICY_LABELS[row.policySlug]?.label ?? row.policySlug)
              .join(", ")}
            .
          </span>
        </label>

        {error ? (
          <p role="alert" className="font-body text-sm text-danger mb-4">
            {error}
          </p>
        ) : null}

        <Button
          type="button"
          onClick={handleAccept}
          disabled={!checked || pending}
          className="w-full"
          data-testid="policy-updated-accept"
        >
          {pending ? "Saving\u2026" : "Accept and continue"}
        </Button>
      </div>
    </main>
  );
}
