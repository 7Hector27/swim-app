import "dotenv/config";
import { db } from "./client";
import { clubs } from "./schema";

async function seed() {
  await db
    .insert(clubs)
    .values([{ name: "[Club 1]" }, { name: "[Club 2]" }])
    .onConflictDoNothing({ target: clubs.name });

  process.stdout.write("Seed complete.\n");
}

seed().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
