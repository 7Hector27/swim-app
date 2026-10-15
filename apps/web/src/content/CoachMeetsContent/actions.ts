"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CreateMeetBodySchema } from "@swim-app/shared";
import { createClient } from "@/lib/supabase/server";

export type CreateMeetState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

export async function createMeet(
  _prev: CreateMeetState,
  formData: FormData,
): Promise<CreateMeetState> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const raw = {
    name: formData.get("name"),
    meetDate: formData.get("meetDate"),
    course: formData.get("course"),
  };

  const parsed = CreateMeetBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: "Please fill in all required fields." };
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/meets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parsed.data),
  });

  if (response.status === 401) redirect("/api/signout");
  if (!response.ok) {
    return { status: "error", message: "Could not create meet. Please try again." };
  }

  revalidatePath("/coach/meets");
  return { status: "success" };
}

export type DeleteMeetState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

export async function deleteMeet(
  meetId: string,
  _prev: DeleteMeetState,
): Promise<DeleteMeetState> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/meets/${meetId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (response.status === 401) redirect("/api/signout");
  if (response.status === 422) {
    return { status: "error", message: "This meet has recorded swims and cannot be deleted." };
  }
  if (!response.ok) {
    return { status: "error", message: "Could not delete meet. Please try again." };
  }

  revalidatePath("/coach/meets");
  return { status: "success" };
}
