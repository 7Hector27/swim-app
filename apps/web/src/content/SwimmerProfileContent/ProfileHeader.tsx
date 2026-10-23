import Link from "next/link";

import type { ParentSwimmer } from "@swim-app/shared";

interface ProfileHeaderProps {
  swimmer: ParentSwimmer;
  age: number;
  clubName: string | null;
  canEdit: boolean;
  canBook: boolean;
}

export default function ProfileHeader({
  swimmer,
  age,
  clubName,
  canEdit,
  canBook,
}: ProfileHeaderProps) {
  const initials =
    `${swimmer.firstName[0] ?? ""}${swimmer.lastName[0] ?? ""}`.toUpperCase();

  return (
    <header
      className="
        flex flex-col gap-4
        tablet:flex-row tablet:items-center tablet:justify-between tablet:gap-6
      "
    >
      <div
        className="
          flex items-center gap-3
          tablet:gap-4 tablet:flex-1 tablet:min-w-0
        "
      >
        <div
          className="
            w-12 h-12 flex-shrink-0 rounded-full bg-surface-soft
            flex items-center justify-center
            tablet:w-16 tablet:h-16 desktop:w-20 desktop:h-20
          "
          aria-hidden="true"
        >
          <span
            className="
              font-heading text-base text-text-secondary select-none
              tablet:text-xl desktop:text-2xl
            "
          >
            {initials}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h1
            className="
              font-heading text-xl text-heading leading-none
              tablet:text-2xl desktop:text-3xl
            "
          >
            {swimmer.firstName} {swimmer.lastName}
          </h1>
          <p
            className="
              text-xs text-text-secondary mt-1.5
              tablet:text-sm tablet:mt-2
            "
          >
            Age {age}
            {clubName ? ` · ${clubName}` : null}
          </p>
        </div>
      </div>

      {(canBook || canEdit) && (
        <div
          className="
            flex gap-2
            tablet:flex-shrink-0
          "
        >
          {canBook && (
            <Link
              href="/dashboard/book"
              className="
                flex-1 rounded-button bg-button-primary-background text-button-primary-text
                font-bold text-sm h-11 flex items-center justify-center px-5
                transition-transform duration-150 active:scale-[0.97]
                tablet:flex-initial
              "
            >
              Book a lesson
            </Link>
          )}
          {canEdit && (
            <Link
              href={`/dashboard/swimmers/${swimmer.id}/edit`}
              aria-label={`Edit ${swimmer.firstName}`}
              className="
                w-11 h-11 flex-shrink-0 rounded-button border border-border text-text
                transition-[transform,background-color] duration-150 active:scale-[0.97]
                flex items-center justify-center hover:bg-surface-soft
              "
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5Z" />
              </svg>
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
