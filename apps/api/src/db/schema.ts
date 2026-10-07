import { authUsers } from "drizzle-orm/supabase";
import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["coach", "parent"]);

export const profiles = pgTable(
  "profiles",
  {
    // No default — this id mirrors auth.users.id and is set by the on_auth_user_created trigger.
    id: uuid("id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    role: userRoleEnum("role").notNull().default("parent"),
    fullName: text("full_name"),
    phone: text("phone"),
    ageAttestedAt: timestamp("age_attested_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
).enableRLS();
