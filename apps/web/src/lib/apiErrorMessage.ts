const MESSAGES: Record<string, string> = {
  slot_unavailable: "That time isn't available anymore. Pick another one.",
  not_a_lesson_day: "Jason doesn't teach on that day.",
  too_far: "That time is more than 10 weeks away.",
  lesson_not_active: "This lesson has already been canceled or completed.",
  lesson_in_past: "This lesson has already started and can't be changed.",
  invalid_event: "That distance and stroke combination isn't a valid event.",
  invalid_time: "Use the format M:SS.HH or SS.HH (e.g. 1:02.34 or 58.30).",
  invalid_time_granularity: "Times must be on the quarter hour (:00, :15, :30, or :45).",
  weekday_start_required: "Add a weekday start time, since this season teaches on weekdays.",
  weekday_start_without_weekday: "Remove the weekday start time, since no weekdays are selected.",
  weekend_start_required: "Add a weekend start time, since this season teaches on weekends.",
  weekend_start_without_weekend: "Remove the weekend start time, since no weekends are selected.",
  weekday_end_required: "Add a weekday end time, since this season teaches on weekdays.",
  weekday_end_without_weekday: "Remove the weekday end time, since no weekdays are selected.",
  weekend_end_required: "Add a weekend end time, since this season teaches on weekends.",
  weekend_end_without_weekend: "Remove the weekend end time, since no weekends are selected.",
  start_not_before_end: "Start time must be before the end time.",
  season_date_taken: "Another season already starts on that date.",
  invalid_date_range: "End date must be the same day or later than the start date.",
  day_off_with_times: "Day-off overrides can't include start or end times.",
  custom_hours_missing_times: "Custom-hours overrides need both a start and end time.",
  custom_hours_date_mismatch: "Custom-hours overrides must start and end on the same day.",
  override_conflict: "This override overlaps an existing one.",
  end_date_before_start: "End date must be on or after the start date.",
};

export function apiErrorMessage(
  code: string | undefined,
  conflictingSeasonName?: string,
  bookingMinAdvanceHours?: number,
): string {
  if (!code) return "Something went wrong on our end. Try again in a moment.";
  if (code === "season_overlap") {
    const name = conflictingSeasonName ?? "another season";
    return `This season overlaps with "${name}". Adjust the dates.`;
  }
  if (code === "too_soon") {
    const hours = bookingMinAdvanceHours ?? 16;
    const unit = hours === 1 ? "hour" : "hours";
    return `That time is less than ${hours} ${unit} away. Text Jason to book it.`;
  }
  if (MESSAGES[code]) return MESSAGES[code]!;
  return "Something went wrong on our end. Try again in a moment.";
}
