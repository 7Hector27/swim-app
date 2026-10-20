import { todayLA } from "@swim-app/shared";
import { requireAuth } from "@/lib/requireAuth";
import CoachScheduleContent from "@/content/CoachScheduleContent";
import { mondayOf } from "@/lib/calendarDate";

interface SearchParams {
  date?: string;
  view?: string;
}

interface Props {
  searchParams: Promise<SearchParams>;
}

export default async function CoachSchedulePage({ searchParams }: Props) {
  const auth = await requireAuth();
  const params = await searchParams;
  const today = todayLA();
  const view = params.view === "week" ? "week" : "day";
  const rawDate = params.date ?? today;
  // For week view, normalize to Monday so the grid always starts on Monday.
  const date = view === "week" ? mondayOf(rawDate) : rawDate;

  if (!auth) return null;

  return (
    <CoachScheduleContent
      accessToken={auth.accessToken}
      date={date}
      view={view}
      today={today}
    />
  );
}
