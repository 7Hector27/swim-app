"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type RemoveSwimmerState = { status: "idle" } | { status: "error"; message: string };

export async function removeSwimmer(
  swimmerId: string,
  _prevState: RemoveSwimmerState,
  _formData: FormData,
): Promise<RemoveSwimmerState> {
  const supabase = await createClient();
  // getSession is called only to extract the raw access token for forwarding to
  // the API. The API's requireUser middleware verifies the token independently.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) redirect("/login");

  let status: number;
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/swimmers/${swimmerId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    status = response.status;
  } catch {
    return { status: "error", message: "Something went wrong. Please try again." };
  }

  if (status === 204 || status === 404) {
    revalidatePath("/dashboard", "page");
    redirect("/dashboard");
  }

  return { status: "error", message: "Something went wrong. Please try again." };
}
