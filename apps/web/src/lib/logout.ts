"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function logout(_formData?: FormData): Promise<void> {
  const supabase = await createClient();
  try {
    await supabase.auth.signOut();
  } catch {
    // signOut failed (e.g. network error). Cookies may not be fully cleared
    // server-side, but we proceed so the user is never stuck on a protected
    // page appearing signed in.
  }
  revalidatePath("/", "layout");
  redirect("/");
}
