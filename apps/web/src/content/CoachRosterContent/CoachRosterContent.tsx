"use client";

import { useState } from "react";
import type { CoachSwimmer, League, MeetResponse } from "@swim-app/shared";

import { CoachMeetsPanel } from "@/content/CoachMeetsContent";

interface CoachRosterContentProps {
  swimmers: CoachSwimmer[];
  // ADR 036 Phase 8 Part B Stop 3 piece 6: meets moved onto the
  // Swimmers page as a tab. The server page fetches both lists in
  // parallel and hands them down; the tab control is local state.
  meets: MeetResponse[];
  // Deep-link support — /coach/meets redirects to
  // /coach/swimmers?tab=meets, so the page can open with the Meets
  // tab preselected without a client-side flash.
  initialTab: TabId;
}

type TabId = "swimmers" | "meets";

const LEAGUE_LABELS: Record<League, string> = {
  club: "Club",
  summer_league: "Summer League",
};

function swimmerClubLabel(clubs: CoachSwimmer["clubs"]): string {
  return clubs
    .map((club) => club.clubName ?? club.otherClubName)
    .filter((name): name is string => name !== null)
    .join(", ");
}

export default function CoachRosterContent({
  swimmers,
  meets,
  initialTab,
}: CoachRosterContentProps) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
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
      <div
        role="tablist"
        aria-label="Swimmers and meets"
        className="flex gap-6 border-b border-border"
      >
        <TabButton
          id="swimmers"
          label="Swimmers"
          active={activeTab === "swimmers"}
          onSelect={setActiveTab}
        />
        <TabButton
          id="meets"
          label="Meets"
          active={activeTab === "meets"}
          onSelect={setActiveTab}
        />
      </div>

      {activeTab === "swimmers" ? (
        <div
          role="tabpanel"
          aria-labelledby="tab-swimmers"
          data-testid="coach-swimmers-panel"
          className="flex flex-col gap-6"
        >
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
                const clubLabel = swimmerClubLabel(swimmer.clubs);
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
                      {clubLabel && (
                        <p className="text-xs text-text-secondary">{clubLabel}</p>
                      )}
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
      ) : (
        <div
          role="tabpanel"
          aria-labelledby="tab-meets"
          data-testid="coach-meets-panel"
        >
          <CoachMeetsPanel meets={meets} />
        </div>
      )}
    </div>
  );
}

function TabButton({
  id,
  label,
  active,
  onSelect,
}: {
  id: TabId;
  label: string;
  active: boolean;
  onSelect: (id: TabId) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={active}
      onClick={() => onSelect(id)}
      className={[
        "relative min-h-[44px] px-1 font-semibold text-sm transition-colors",
        active ? "text-text" : "text-text-secondary hover:text-text",
      ].join(" ")}
    >
      {label}
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 right-0 -bottom-px h-0.5 bg-accent"
        />
      )}
    </button>
  );
}
