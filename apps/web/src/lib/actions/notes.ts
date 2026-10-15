"use server";

import { redirect } from "next/navigation";
import { CoachNoteTypeSchema } from "@swim-app/shared";
import { createClient } from "@/lib/supabase/server";

export type NoteActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

export async function createNoteAction(
  swimmerId: string,
  sessionId: string | null,
  lessonId: string | null,
  _prev: NoteActionState,
  formData: FormData,
): Promise<NoteActionState> {
  const body = formData.get("body");
  if (typeof body !== "string" || !body.trim()) {
    return { status: "error", message: "Note cannot be blank." };
  }

  const noteTypeParsed = CoachNoteTypeSchema.safeParse(formData.get("noteType"));
  if (!noteTypeParsed.success) {
    return { status: "error", message: "Invalid note type." };
  }

  const supabase = await createClient();
  // getSession() is used only to extract the raw token for forwarding to the API.
  // The API's requireUser middleware calls getUser() server-to-server to verify it.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const payload: Record<string, string> = { body: body.trim(), noteType: noteTypeParsed.data };
  if (sessionId) payload["sessionId"] = sessionId;
  if (lessonId) payload["lessonId"] = lessonId;
  const skillId = formData.get("skillId");
  if (typeof skillId === "string" && skillId) payload["skillId"] = skillId;

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/notes`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (response.status === 401) redirect("/api/signout");
  if (response.status === 201) return { status: "success" };
  return { status: "error", message: "Failed to save note. Please try again." };
}

export async function updateNoteAction(
  swimmerId: string,
  noteId: string,
  _prev: NoteActionState,
  formData: FormData,
): Promise<NoteActionState> {
  const body = formData.get("body");
  if (typeof body !== "string" || !body.trim()) {
    return { status: "error", message: "Note cannot be blank." };
  }

  const noteTypeParsed = CoachNoteTypeSchema.safeParse(formData.get("noteType"));
  if (!noteTypeParsed.success) {
    return { status: "error", message: "Invalid note type." };
  }

  const supabase = await createClient();
  // getSession() is used only to extract the raw token for forwarding to the API.
  // The API's requireUser middleware calls getUser() server-to-server to verify it.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const skillId = formData.get("skillId");
  const payload: Record<string, string | null> = {
    body: body.trim(),
    noteType: noteTypeParsed.data,
    skillId: typeof skillId === "string" && skillId ? skillId : null,
  };

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/notes/${noteId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (response.status === 401) redirect("/api/signout");
  if (response.status === 200) return { status: "success" };
  if (response.status === 403) return { status: "error", message: "You can only edit your own notes." };
  return { status: "error", message: "Failed to update note. Please try again." };
}

export async function deleteNoteAction(
  swimmerId: string,
  noteId: string,
  _prev: NoteActionState,
  _formData: FormData,
): Promise<NoteActionState> {
  const supabase = await createClient();
  // getSession() is used only to extract the raw token for forwarding to the API.
  // The API's requireUser middleware calls getUser() server-to-server to verify it.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/notes/${noteId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    },
  );

  if (response.status === 401) redirect("/api/signout");
  if (response.status === 204) return { status: "success" };
  if (response.status === 403) return { status: "error", message: "You can only delete your own notes." };
  return { status: "error", message: "Failed to delete note. Please try again." };
}
