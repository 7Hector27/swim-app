import "dotenv/config";
import { db } from "./client";
import { clubs } from "./schema";

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

  process.stdout.write("Seed complete.\n");
}

seed()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
  });
