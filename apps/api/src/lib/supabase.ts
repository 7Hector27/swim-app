import { createClient } from "@supabase/supabase-js";
import { getEnv } from "./env";

const env = getEnv();
export const supabase = createClient(env.supabaseUrl, env.supabasePublishableKey);
