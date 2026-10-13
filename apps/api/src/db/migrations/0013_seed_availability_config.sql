INSERT INTO availability_config (
  id,
  lesson_days,
  school_year_start_time,
  school_year_end_time,
  summer_morning_start_time,
  summer_morning_end_time,
  summer_evening_start_time,
  summer_evening_end_time,
  max_daily_lesson_minutes,
  booking_min_advance_hours,
  booking_max_advance_weeks
) VALUES (
  gen_random_uuid(),
  '{1,2,3,5}',
  '16:30',
  '20:30',
  '08:00',
  '14:00',
  '19:30',
  '21:00',
  240,
  16,
  10
);