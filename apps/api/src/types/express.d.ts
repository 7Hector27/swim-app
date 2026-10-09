import type { InferSelectModel } from "drizzle-orm";
import type { profiles } from "../db/schema";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      profile: InferSelectModel<typeof profiles>;
      userEmail: string;
    }
  }
}

export {};
