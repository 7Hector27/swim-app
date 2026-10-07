import { createClient } from "@supabase/supabase-js";

const url = process.env["SUPABASE_URL"];
const key = process.env["SUPABASE_PUBLISHABLE_KEY"];

if (!url) throw new Error("SUPABASE_URL is required");
if (!key) throw new Error("SUPABASE_PUBLISHABLE_KEY is required");

export const supabase = createClient(url, key);
