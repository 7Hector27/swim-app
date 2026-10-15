"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CreateMeetSwimBodySchema } from "@swim-app/shared";
import { createClient } from "@/lib/supabase/server";

export type AddSwimState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

export async function addSwim(
  meetId: string,
  _prev: AddSwimState,
  formData: FormData,
): Promise<AddSwimState> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const swimmerId = formData.get("swimmerId");
  if (typeof swimmerId !== "string" || !swimmerId) {
    return { status: "error", message: "Please select a swimmer." };
  }

  const raw = {
    swimType: "meet",
    meetId,
    eventDistance: Number(formData.get("eventDistance")),
    eventStroke: formData.get("eventStroke"),
    course: formData.get("course"),
    timeString: formData.get("timeString"),
    swumOn: formData.get("swumOn"),
  };

  const parsed = CreateMeetSwimBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: "Please fill in all required fields." };
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/meet-swims`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parsed.data),
    },
  );

  if (response.status === 401) redirect("/api/signout");
  if (response.status === 422) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (body.error === "invalid_event") {
      return { status: "error", message: "That distance and stroke combination is not a valid event." };
    }
    if (body.error === "invalid_time") {
      return { status: "error", message: "Invalid time format. Use M:SS.HH or SS.HH (e.g. 1:02.34 or 58.30)." };
    }
    return { status: "error", message: "Invalid swim data. Please check your entries." };
  }
  if (!response.ok) {
    return { status: "error", message: "Could not record swim. Please try again." };
  }

  revalidatePath(`/coach/meets/${meetId}`);
  return { status: "success" };
}
