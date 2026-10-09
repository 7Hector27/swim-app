import type { Metadata } from "next";

import AccountContent from "@/content/AccountContent";

export const metadata: Metadata = {
  title: "Account · JG Swim",
};

export default function AccountPage() {
  return <AccountContent />;
}
