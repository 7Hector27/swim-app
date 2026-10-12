"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

type SimpleState = { status: "idle" } | { status: "success" } | { status: "error"; message: string };

export type GenerateInviteState =
  | { status: "idle" }
  | { status: "success"; url: string; expiresAt: string }
  | { status: "error"; message: string };

async function getToken(): Promise<string | null> {
  // getSession is called only to extract the raw access token for forwarding to
  // the API. The API's requireUser middleware verifies the token independently.
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function apiError(res: Response | null, fallback: string): Promise<string> {
  if (!res) return fallback;
  const body = await res.json().catch(() => ({})) as { error?: string };
  return body.error ?? fallback;
}

export async function renameHouseholdAction(_prev: SimpleState, formData: FormData): Promise<SimpleState> {
  const name = (formData.get("name") as string | null)?.trim();
  if (!name) return { status: "error", message: "Name is required." };

  const token = await getToken();
  if (!token) redirect("/login");

  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/households/mine`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  }).catch(() => null);

  if (!res?.ok) return { status: "error", message: await apiError(res, "Could not save changes.") };

  revalidatePath("/household");
  return { status: "success" };
}

export async function changeMemberRoleAction(
  profileId: string,
  _prev: SimpleState,
  formData: FormData,
): Promise<SimpleState> {
  const role = formData.get("role") as string | null;
  if (!role) return { status: "error", message: "Role is required." };

  const token = await getToken();
  if (!token) redirect("/login");

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/households/mine/members/${profileId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role }),
    },
  ).catch(() => null);

  if (!res?.ok) return { status: "error", message: await apiError(res, "Could not update role.") };

  revalidatePath("/household");
  return { status: "success" };
}

export async function removeMemberAction(
  profileId: string,
  _prev: SimpleState,
  _formData: FormData,
): Promise<SimpleState> {
  const token = await getToken();
  if (!token) redirect("/login");

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/households/mine/members/${profileId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  ).catch(() => null);

  if (!res?.ok) return { status: "error", message: await apiError(res, "Could not remove member.") };

  revalidatePath("/household");
  return { status: "success" };
}

export async function leaveHouseholdAction(_prev: SimpleState, _formData: FormData): Promise<SimpleState> {
  const token = await getToken();
  if (!token) redirect("/login");

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/households/mine/members/me`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  ).catch(() => null);

  if (!res?.ok) return { status: "error", message: await apiError(res, "Could not leave household.") };

  redirect("/dashboard");
}

export async function transferOwnershipAction(
  newOwnerProfileId: string,
  _prev: SimpleState,
  _formData: FormData,
): Promise<SimpleState> {
  const token = await getToken();
  if (!token) redirect("/login");

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/households/mine/transfer-ownership`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ newOwnerProfileId }),
    },
  ).catch(() => null);

  if (!res?.ok) return { status: "error", message: await apiError(res, "Could not transfer ownership.") };

  revalidatePath("/household");
  return { status: "success" };
}

export async function generateInviteAction(_prev: GenerateInviteState, _formData: FormData): Promise<GenerateInviteState> {
  const token = await getToken();
  if (!token) redirect("/login");

  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/households/mine/invites`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);

  if (!res?.ok) return { status: "error", message: "Could not generate invite link." };

  const body = await res.json().catch(() => null) as { url?: string; expiresAt?: string } | null;
  if (!body?.url || !body.expiresAt) return { status: "error", message: "Could not generate invite link." };

  revalidatePath("/household");
  return { status: "success", url: body.url, expiresAt: body.expiresAt };
}

export async function revokeInviteAction(
  inviteId: string,
  _prev: SimpleState,
  _formData: FormData,
): Promise<SimpleState> {
  const token = await getToken();
  if (!token) redirect("/login");

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/households/mine/invites/${inviteId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  ).catch(() => null);

  if (!res?.ok) return { status: "error", message: await apiError(res, "Could not revoke invite.") };

  revalidatePath("/household");
  return { status: "success" };
}
