import type { League } from "../schemas/registration";

// Jason needs to confirm this month value (1–12). September = 9.
export const CLUB_SEASON_START_MONTH = 9;

/**
 * Returns the calendar year in which the current season started.
 * Accepts an America/Los_Angeles date string (e.g. from todayLA()).
 *
 * summer_league: always the calendar year.
 * club: starts in CLUB_SEASON_START_MONTH; before that month we're still in
 * the season that began the previous year.
 */
export function currentSeasonStartYear(league: League, today: string): number {
  const year = parseInt(today.slice(0, 4), 10);
  if (league === "summer_league") {
    return year;
  }
  const month = parseInt(today.slice(5, 7), 10);
  return month >= CLUB_SEASON_START_MONTH ? year : year - 1;
}
