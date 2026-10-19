export function findActiveSeasonId(
  seasons: readonly { id: string; startDate: string }[],
  today: string,
): string | null {
  let activeId: string | null = null;
  let activeStart = "";
  for (const season of seasons) {
    if (season.startDate <= today && season.startDate > activeStart) {
      activeStart = season.startDate;
      activeId = season.id;
    }
  }
  return activeId;
}
