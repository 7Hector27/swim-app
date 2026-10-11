"use client";

import { useState } from "react";
import { type CoachSwimmer, type League } from "@swim-app/shared";

interface CoachRosterContentProps {
  swimmers: CoachSwimmer[];
}

const LEAGUE_LABELS: Record<League, string> = {
  club: "Club",
  summer_league: "Summer League",
};

export default function CoachRosterContent({ swimmers }: CoachRosterContentProps) {
  const [search, setSearch] = useState("");
  const [leagueFilter, setLeagueFilter] = useState<League | "all">("all");

  const filtered = swimmers.filter((swimmer) => {
    const fullName = `${swimmer.firstName} ${swimmer.lastName}`.toLowerCase();
    const matchesSearch = search.trim() === "" || fullName.includes(search.trim().toLowerCase());
    const matchesLeague =
      leagueFilter === "all" || swimmer.currentLeagues.includes(leagueFilter);
    return matchesSearch && matchesLeague;
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 tablet:flex-row tablet:items-center tablet:gap-4">
        <label className="sr-only" htmlFor="roster-search">
          Search swimmers
        </label>
        <input
          id="roster-search"
          type="search"
          placeholder="Search by name"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full tablet:max-w-xs rounded-button border border-border bg-background text-text px-4 min-h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring"
        />

        <fieldset className="flex gap-2 flex-wrap">
          <legend className="sr-only">Filter by league</legend>
          {(["all", "club", "summer_league"] as const).map((value) => {
            const label = value === "all" ? "All" : LEAGUE_LABELS[value];
            return (
              <button
                key={value}
                type="button"
                onClick={() => setLeagueFilter(value)}
                className={[
                  "rounded-button px-4 min-h-[44px] text-sm font-semibold border transition-colors",
                  leagueFilter === value
                    ? "bg-button-primary-background text-button-primary-text border-transparent"
                    : "bg-background text-text border-border hover:bg-surface-soft",
                ].join(" ")}
                aria-pressed={leagueFilter === value}
              >
                {label}
              </button>
            );
          })}
        </fieldset>
      </div>

      {filtered.length === 0 ? (
        <p className="text-text-secondary text-sm">No swimmers match your search.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map((swimmer) => {
            return (
              <li key={swimmer.id}>
                <a
                  href={`/coach/swimmers/${swimmer.id}`}
                  className="flex flex-col gap-1 rounded-card border border-border p-4 hover:bg-surface-soft transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-text">
                      {swimmer.firstName} {swimmer.lastName}
                    </p>
                    {!swimmer.isPublic && (
                      <span className="text-xs text-text-secondary border border-border rounded px-2 py-0.5">
                        Hidden
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-text-secondary">Age {swimmer.age}</p>
                  {swimmer.currentLeagues.length > 0 && (
                    <div className="flex gap-2 flex-wrap mt-1">
                      {swimmer.currentLeagues.map((league) => (
                        <span
                          key={league}
                          className="text-xs font-semibold text-accent border border-accent rounded px-2 py-0.5"
                        >
                          {LEAGUE_LABELS[league]}
                        </span>
                      ))}
                    </div>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
