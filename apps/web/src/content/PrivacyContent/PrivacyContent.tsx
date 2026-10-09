import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";

export default function PrivacyContent() {
  return (
    <div className="flex flex-col min-h-screen">
      <SiteNav />
      <main className="flex-1 px-page py-16">
        <div className="mx-auto max-w-content">
          <div className="max-w-2xl">
            <div className="mb-8 px-4 py-3 rounded-lg border border-border bg-surface-soft">
              <p className="text-sm text-text-secondary">
                <strong className="text-text font-semibold">Draft — not in effect.</strong>{" "}
                This policy is a work in progress and has not been reviewed by a lawyer. It does not create any legal obligations until a final version is published.
              </p>
            </div>

            <h1 className="text-heading mb-2">Privacy Policy</h1>
            <p className="text-text-secondary mb-10">[Effective date]</p>

            <div className="flex flex-col gap-10 text-text">
              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Who we are</h2>
                <p className="text-text-secondary leading-relaxed">
                  [Business name] operates the JG Swim website at [domain]. Coach Jason provides private one-on-one swimming lessons to students. This policy describes how we handle information collected through this site.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Who can create an account</h2>
                <p className="text-text-secondary leading-relaxed">
                  Accounts may only be created by adults aged 18 or older. Children under 18 do not create accounts on this site. A parent or guardian may create an account to manage lesson bookings on behalf of a child.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Information we collect</h2>
                <p className="text-text-secondary leading-relaxed mb-3">
                  When you create an account we collect your name, email address, phone number (optional), and date of birth. We use your date of birth to verify you meet the age requirement.
                </p>
                <p className="text-text-secondary leading-relaxed">
                  [Additional data collection details — e.g. lesson records, payment information, cookies — to be completed.]
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">How we use your information</h2>
                <p className="text-text-secondary leading-relaxed mb-3">
                  We use the information you provide to manage your account, schedule and track lessons, and communicate with you about your lessons. We do not sell your personal information.
                </p>
                <p className="text-text-secondary leading-relaxed">
                  [Full use policy to be completed.]
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Lesson records</h2>
                <p className="text-text-secondary leading-relaxed">
                  Lessons are private one-on-one sessions with Coach Jason. Lesson notes and performance records are visible only to Coach Jason and the account holder associated with that lesson. They are never shared publicly or with other students.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Data retention</h2>
                <p className="text-text-secondary leading-relaxed">
                  [Retention policy to be completed.]
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Your rights</h2>
                <p className="text-text-secondary leading-relaxed">
                  [Rights section — deletion, correction, portability — to be completed.]
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Contact</h2>
                <p className="text-text-secondary leading-relaxed">
                  Questions about this policy can be sent to [contact email].
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Governing law</h2>
                <p className="text-text-secondary leading-relaxed">
                  [Governing law and jurisdiction to be completed.]
                </p>
              </section>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
