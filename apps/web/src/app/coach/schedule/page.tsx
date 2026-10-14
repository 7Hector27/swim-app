import { requireAuth } from "@/lib/requireAuth";
import CoachScheduleContent from "@/content/CoachScheduleContent";

export const metadata = { title: "Schedule — Coach Dashboard" };

export default async function CoachSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { todayLA } = await import("@swim-app/shared");
  const result = await requireAuth();
  if (!result) return null;
  const { accessToken } = result;
  const params = await searchParams;
  const date = params.date ?? todayLA();

  return <CoachScheduleContent accessToken={accessToken} date={date} />;
}
