import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import path from "path";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  process.stderr.write("DATABASE_URL is not set\n");
  process.exit(1);
}

let parsed: URL;
try {
  parsed = new URL(connectionString);
} catch {
  process.stderr.write(`DATABASE_URL is not a valid URL: ${connectionString}\n`);
  process.exit(1);
}

const { hostname } = parsed;
if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
  process.stderr.write(
    `Refusing to auto-migrate against a non-local database.\n` +
      `DATABASE_URL must resolve to localhost or 127.0.0.1. Got: ${hostname}\n`,
  );
  process.exit(1);
}

const client = postgres(connectionString, { max: 1, connect_timeout: 5 });

(async () => {
  try {
    await client`SELECT 1`;
  } catch {
    process.stderr.write("Local database isn't running. Run pnpm db:up first.\n");
    await client.end({ timeout: 0 });
    process.exit(1);
  }

  const db = drizzle(client);
  await migrate(db, { migrationsFolder: path.join(__dirname, "migrations") });
  process.stdout.write("Migrations applied\n");
  await client.end();
})();
