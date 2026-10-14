import { todayLA } from "@swim-app/shared";

import { requireAuth } from "@/lib/requireAuth";
import CoachScheduleContent from "@/content/CoachScheduleContent";

interface SearchParams {
  date?: string;
}

interface Props {
  searchParams: Promise<SearchParams>;
}

export default async function CoachSchedulePage({ searchParams }: Props) {
  const auth = await requireAuth();
  const params = await searchParams;
  const date = params.date ?? todayLA();

  if (!auth) return null;

  return <CoachScheduleContent accessToken={auth.accessToken} date={date} />;
}
