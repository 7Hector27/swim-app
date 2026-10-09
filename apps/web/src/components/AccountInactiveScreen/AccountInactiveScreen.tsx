import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";

export default function AccountInactiveScreen() {
  return (
    <div className="flex flex-col min-h-screen">
      <SiteNav />
      <main className="flex-1 flex items-center justify-center px-page py-16">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-heading mb-4">Account not active</h1>
          <p className="text-text-secondary">
            This account is disabled or pending review.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
