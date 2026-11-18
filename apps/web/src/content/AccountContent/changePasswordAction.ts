"use server";

import { redirect } from "next/navigation";

import { ChangePasswordBodySchema, PASSWORD_MIN_LENGTH } from "@swim-app/shared";

import { createClient } from "@/lib/supabase/server";

export type ChangePasswordState =
  | { status: "idle" }
  | { status: "field_errors"; errors: { currentPassword?: string; newPassword?: string; confirmPassword?: string } }
  | { status: "error"; message: string }
  | { status: "success" };

export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const currentPasswordRaw = formData.get("currentPassword");
  const newPasswordRaw = formData.get("newPassword");
  const confirmPasswordRaw = formData.get("confirmPassword");

  if (
    typeof newPasswordRaw === "string"
    && typeof confirmPasswordRaw === "string"
    && newPasswordRaw !== confirmPasswordRaw
  ) {
    return {
      status: "field_errors",
      errors: { confirmPassword: "Passwords don't match." },
    };
  }

  const parsed = ChangePasswordBodySchema.safeParse({
    currentPassword: currentPasswordRaw,
    newPassword: newPasswordRaw,
  });
  if (!parsed.success) {
    const errors: { currentPassword?: string; newPassword?: string } = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "currentPassword") errors.currentPassword = "Enter your current password.";
      if (field === "newPassword") errors.newPassword = `Must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    }
    return { status: "field_errors", errors };
  }

  const supabase = await createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    redirect("/api/signout");
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(parsed.data),
  });

  if (response.status === 204) {
    return { status: "success" };
  }
  if (response.status === 403) {
    return {
      status: "field_errors",
      errors: { currentPassword: "That's not your current password." },
    };
  }
  if (response.status === 429) {
    return {
      status: "error",
      message: "Too many attempts. Please wait a bit and try again.",
    };
  }
  return { status: "error", message: "Could not change your password. Please try again." };
}
