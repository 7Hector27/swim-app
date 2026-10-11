"use client";

import { useActionState } from "react";

import type { Club } from "@swim-app/shared";

import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";
import SwimmerForm from "@/components/SwimmerForm";

import { addSwimmer } from "./actions";
import type { AddSwimmerState } from "./helpers";

const initialState: AddSwimmerState = { status: "idle" };

interface AddSwimmerContentProps {
  clubs: Club[];
}

export default function AddSwimmerContent({ clubs }: AddSwimmerContentProps) {
  const [state, formAction, isPending] = useActionState(addSwimmer, initialState);

  return (
    <div className="flex flex-col min-h-screen">
      <SiteNav />
      <main className="flex-1 px-page py-12 tablet:py-16">
        <div className="mx-auto max-w-md">
          <a
            href="/dashboard"
            className="inline-flex items-center gap-1 text-sm text-link hover:text-link-hover mb-6"
          >
            ← Dashboard
          </a>

          <h1 className="text-heading mb-2">Add a swimmer</h1>
          <p className="text-text-secondary mb-8">Enter your swimmer's details below.</p>

          <SwimmerForm
            clubs={clubs}
            formAction={formAction}
            state={state}
            isPending={isPending}
            mode="add"
          />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
