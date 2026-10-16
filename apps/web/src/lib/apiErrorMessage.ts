const MESSAGES: Record<string, string> = {
  too_soon: "That time is less than 16 hours away. Text Jason to book it.",
  slot_unavailable: "Someone just took that time. Pick another one.",
  not_a_lesson_day: "Jason doesn't teach on that day.",
  too_far: "That time is more than 10 weeks away.",
  lesson_not_active: "This lesson has already been canceled or completed.",
  lesson_in_past: "This lesson has already started and can't be changed.",
  invalid_event: "That distance and stroke combination isn't a valid event.",
  invalid_time: "Use the format M:SS.HH or SS.HH (e.g. 1:02.34 or 58.30).",
};

export function apiErrorMessage(code: string | undefined): string {
  if (code && MESSAGES[code]) return MESSAGES[code]!;
  return "Something went wrong on our end. Try again in a moment.";
}
