"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { type HideSwimmerState, mapHideApiResponse } from "./helpers";

export async function hideSwimmer(
  swimmerId: string,
  _prev: HideSwimmerState,
): Promise<HideSwimmerState> {
  const supabase = await createClient();
  // getSession is called only to extract the raw access token for forwarding to
  // the API. The API's requireUser middleware verifies the token independently.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/visibility`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isPublic: false }),
    },
  );

  if (response.status === 204) {
    redirect(`/coach/swimmers/${swimmerId}`);
  }

  return mapHideApiResponse(response.status);
}
