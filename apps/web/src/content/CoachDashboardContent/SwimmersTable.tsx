"use client";

import { useState } from "react";

import type { CoachSwimmer } from "@swim-app/shared";

import Placeholder from "@/components/Placeholder";

interface SwimmersTableProps {
  swimmers: CoachSwimmer[];
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
          className="w-full max-w-xs h-9 px-3 rounded-button border border-border bg-background text-sm text-text placeholder:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
        />
      </div>

      <div className="overflow-x-auto">
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
                  <td className="px-5 py-3 text-text-secondary whitespace-nowrap">
                    <Placeholder>
                      <span>[Oct 18]</span>
                    </Placeholder>
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    {swimmer.isPublic ? (
                      <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-success/10 text-success">
                        Public
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 bg-surface-soft text-text-secondary border border-border">
                        Private
                      </span>
                    )}
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
