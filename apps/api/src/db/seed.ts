import "dotenv/config";
import { db } from "./client";
import { availabilitySeasons, clubs } from "./schema";

const JASON_SEASONS = [
  { name: "Jun – Jul",     startDate: "2026-06-01", weekdayStartTime: "17:00", weekendStartTime: "17:00", endTime: "21:00", startsAtDst: false },
  { name: "Mid-Aug",       startDate: "2026-08-15", weekdayStartTime: "16:45", weekendStartTime: "16:45", endTime: "20:30", startsAtDst: false },
  { name: "Mid-Sep",       startDate: "2026-09-15", weekdayStartTime: "16:00", weekendStartTime: "16:00", endTime: "19:30", startsAtDst: false },
  { name: "Mid-Oct",       startDate: "2026-10-15", weekdayStartTime: "15:00", weekendStartTime: "15:00", endTime: "18:30", startsAtDst: false },
  { name: "Nov",           startDate: "2026-11-01", weekdayStartTime: "14:30", weekendStartTime: "13:00", endTime: "17:30", startsAtDst: false },
  { name: "Dec – mid-Jan", startDate: "2026-12-01", weekdayStartTime: "14:30", weekendStartTime: "10:00", endTime: "17:00", startsAtDst: false },
  { name: "Mid-Feb",       startDate: "2027-02-15", weekdayStartTime: "14:30", weekendStartTime: "14:00", endTime: "18:00", startsAtDst: false },
  { name: "Early Mar",     startDate: "2027-03-01", weekdayStartTime: "15:00", weekendStartTime: "15:00", endTime: "18:30", startsAtDst: false },
  { name: "Mid-Mar",       startDate: "2027-03-14", weekdayStartTime: "16:00", weekendStartTime: "16:00", endTime: "19:30", startsAtDst: true  },
  { name: "Mid-Apr",       startDate: "2027-04-15", weekdayStartTime: "16:30", weekendStartTime: "16:30", endTime: "20:00", startsAtDst: false },
  { name: "Mid-May",       startDate: "2027-05-15", weekdayStartTime: "16:45", weekendStartTime: "16:45", endTime: "20:30", startsAtDst: false },
].map((season) => ({ ...season, teachesDays: [1, 2, 3, 4, 5, 6, 7] }));

async function seed() {
  await db
    .insert(clubs)
    .values([{ name: "[Club 1]" }, { name: "[Club 2]" }])
    .onConflictDoNothing({ target: clubs.name });

  await db
    .insert(availabilitySeasons)
    .values(JASON_SEASONS)
    .onConflictDoNothing({ target: availabilitySeasons.startDate });

  process.stdout.write("Seed complete.\n");
}

seed().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
