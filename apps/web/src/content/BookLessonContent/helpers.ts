import { isApiBody } from "@/lib/mapZodErrors";

export type BookLessonState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; lessonId: string; autoApproved: boolean };

const ERROR_CODE_MESSAGES: Record<string, string> = {
  not_a_lesson_day: "That day isn't available for lessons.",
  too_soon: "That slot is less than 16 hours away — to book, please text Jason.",
  too_far: "You can only book lessons up to 10 weeks in advance.",
  slot_unavailable: "That slot was just taken. Please pick another time.",
};

export function formatSlotTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function mapBookingApiResponse(
  status: number,
  body: unknown,
): Exclude<BookLessonState, { status: "idle" | "success" }> {
  if (status === 403) {
    return {
      status: "error",
      message:
        "You don't have permission to book lessons. Ask the household owner for booking access.",
    };
  }

  if (status === 422 && isApiBody(body) && typeof body.error === "string") {
    const friendly = ERROR_CODE_MESSAGES[body.error];
    if (friendly) {
      return { status: "error", message: friendly };
    }
  }

  return { status: "error", message: "Something went wrong. Please try again." };
}
