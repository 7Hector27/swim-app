"use client";

import { useState } from "react";

import type { CoachSwimmer } from "@swim-app/shared";

interface SwimmersTableProps {
  swimmers: CoachSwimmer[];
}

// "Oct 28" in Los Angeles time — matches how the column header reads.
function formatLastLessonDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function VisibilityBadge({ isPublic }: { isPublic: boolean }) {
  if (isPublic) {
    return (
      <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-success/10 text-success">
        Public
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-surface-soft text-text-secondary border border-border">
      Private
    </span>
  );
}

export default function SwimmersTable({ swimmers }: SwimmersTableProps) {
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = q
    ? swimmers.filter(
        (swimmer) =>
          `${swimmer.firstName} ${swimmer.lastName}`.toLowerCase().includes(q) ||
          swimmer.memberNames.some((name) => name.toLowerCase().includes(q)),
      )
    : swimmers.slice(0, 8);

  return (
    <div>
      <div className="px-5 py-3 border-b border-border">
        <label htmlFor="swimmers-search" className="sr-only">
          Search swimmers
        </label>
        <input
          id="swimmers-search"
          type="search"
          placeholder="Search by swimmer or parent name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full tablet:max-w-xs h-9 px-3 rounded-button border border-border bg-background text-sm text-text placeholder:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
        />
      </div>

      {/* Phone layout — compact rows */}
      <ul className="divide-y divide-border tablet:hidden">
        {filtered.length === 0 ? (
          <li className="px-5 py-8 text-center text-sm text-text-secondary">
            No swimmers match your search.
          </li>
        ) : (
          filtered.map((swimmer) => (
            <li key={swimmer.id} className="flex items-center gap-3 px-5 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold text-text">
                    {swimmer.firstName} {swimmer.lastName}
                  </span>
                  <span className="text-xs text-text-secondary">Age {swimmer.age}</span>
                  <VisibilityBadge isPublic={swimmer.isPublic} />
                </div>
                {swimmer.memberNames.length > 0 && (
                  <p className="text-xs text-text-secondary mt-0.5 truncate">
                    {swimmer.memberNames.join(", ")}
                  </p>
                )}
              </div>
              <a
                href={`/coach/swimmers/${swimmer.id}`}
                className="flex-shrink-0 min-h-[44px] flex items-center text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
              >
                Open
              </a>
            </li>
          ))
        )}
      </ul>

      {/* Tablet+ layout — table */}
      <div className="hidden tablet:block overflow-x-auto">
        <table className="min-w-full text-sm text-text border-collapse">
          <thead>
            <tr className="border-b border-border bg-surface-soft">
              <th
                scope="col"
                className="px-5 py-2.5 text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wide whitespace-nowrap"
              >
                Swimmer
              </th>
              <th
                scope="col"
                className="px-5 py-2.5 text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wide whitespace-nowrap"
              >
                Age
              </th>
              <th
                scope="col"
                className="px-5 py-2.5 text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wide whitespace-nowrap"
              >
                Parent
              </th>
              <th
                scope="col"
                className="px-5 py-2.5 text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wide whitespace-nowrap"
              >
                Last lesson
              </th>
              <th
                scope="col"
                className="px-5 py-2.5 text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wide whitespace-nowrap"
              >
                Profile
              </th>
              <th scope="col" className="sr-only">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-5 py-8 text-center text-sm text-text-secondary"
                >
                  No swimmers match your search.
                </td>
              </tr>
            ) : (
              filtered.map((swimmer) => (
                <tr
                  key={swimmer.id}
                  className="hover:bg-surface-soft transition-colors duration-100"
                >
                  <td className="px-5 py-3 font-semibold text-text whitespace-nowrap">
                    {swimmer.firstName} {swimmer.lastName}
                  </td>
                  <td className="px-5 py-3 text-text-secondary tabular-nums whitespace-nowrap">
                    {swimmer.age}
                  </td>
                  <td className="px-5 py-3 text-text-secondary">
                    {swimmer.memberNames.length > 0
                      ? swimmer.memberNames.join(", ")
                      : "—"}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    {swimmer.lastLesson ? (
                      <a
                        href={`/coach/lessons/${swimmer.lastLesson.id}`}
                        className="text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150 tabular-nums"
                      >
                        {formatLastLessonDate(swimmer.lastLesson.startsAt)}
                      </a>
                    ) : (
                      <span className="text-text-secondary">None yet</span>
                    )}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <VisibilityBadge isPublic={swimmer.isPublic} />
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <a
                      href={`/coach/swimmers/${swimmer.id}`}
                      className="text-sm font-semibold text-link hover:text-link-hover transition-colors duration-150"
                    >
                      Open
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
