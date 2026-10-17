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

const REAL_CLUBS = [
  "Anaheim Aquatics Association",
  "Aquazot Swim Club (AZOT)",
  "Brea Aquatics",
  "Brea Glenbrook Swim Team",
  "CTI Aquatics",
  "Coastal Machine Aquatics Club (CMAC)",
  "Coto Coyotes",
  "Dolphin Aquatics",
  "East Lake Eagle Rays",
  "Elite Aquatics Sports Team",
  "Evolution Racing Club",
  "Fullerton Aquatics Sports Team (FAST)",
  "Garden Grove Aquatics",
  "Golden West Swim Club",
  "Irvine Novaquatics (NOVA)",
  "JCC Waves",
  "Life Time Swim Southern California",
  "Mission Viejo Nadadores (MVN)",
  "Newport Beach Swimming",
  "OC Riptide Aquatics",
  "Orange County Gold",
  "Patriot Swim Club",
  "San Clemente Aquatics",
  "Seal Beach Swim Club",
  "SoCal Aquatics Association",
  "South Orange County Aquatics",
  "Speed Aquatics",
  "Splash Aquatics",
  "Swim Team of Placentia",
  "SwimNation Aquatics (SNAP!)",
  "The Swim Team (TST)",
  "Tustin Dolphins",
  "Waterworks Aquatics Swim Club",
  "Woodbridge Wahoos",
  "YMCA of Orange County",
];

async function seed() {
  await db
    .insert(clubs)
    .values(REAL_CLUBS.map((name) => ({ name })))
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
