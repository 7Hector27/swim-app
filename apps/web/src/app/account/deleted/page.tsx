import type { Metadata } from "next";
import Link from "next/link";

// Public post-deletion page shown immediately after a successful
// POST /me/deletion/confirm. The server action signs the user out
// before redirecting here; this page MUST NOT require auth. Anyone
// hitting the URL (shared link, back button) sees the same copy —
// there's nothing account-specific on the page.

export const metadata: Metadata = {
  title: "Account deleted · Axiom Aquatics",
};

export default function AccountDeletedPage() {
  return (
    <div className="flex flex-col flex-1">
      <main
        id="main-content"
        className="flex-1 flex items-center justify-center px-page py-16"
      >
        <div className="w-full max-w-md text-center flex flex-col gap-5">
          <h1 className="text-heading">Account deleted</h1>
          <p className="text-text-secondary">
            Your account is closed. Thanks for being part of Axiom Aquatics.
          </p>
          <p className="text-sm text-text-secondary">
            If you change your mind later, you can sign up again from the home page.
          </p>
          <div className="flex justify-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-button font-bold text-sm min-h-[52px] px-7 bg-button-primary-background text-button-primary-text"
            >
              Back to home
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
