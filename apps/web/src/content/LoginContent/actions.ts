"use server";

import { redirect } from "next/navigation";
import { isSafeReturnTo, LoginBodySchema } from "@swim-app/shared";
import { createClient } from "@/lib/supabase/server";

const SITE_ORIGIN = process.env["NEXT_PUBLIC_SITE_URL"] ?? "http://localhost:3000";

export async function login(
  _prev: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const parsed = LoginBodySchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Email or password is incorrect." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: "Email or password is incorrect." };
  }

  const returnToRaw = formData.get("returnTo");
  if (typeof returnToRaw === "string" && isSafeReturnTo(returnToRaw, SITE_ORIGIN)) {
    redirect(returnToRaw);
  }
  redirect("/dashboard");
}
