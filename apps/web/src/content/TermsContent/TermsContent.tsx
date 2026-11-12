import { TERMS_VERSION } from "@swim-app/shared";

import PolicyMeta from "@/components/PolicyMeta";

export default function TermsContent() {
  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 px-page py-16">
        <div className="mx-auto max-w-content">
          <div className="max-w-2xl">
            <div className="mb-8 px-4 py-3 rounded-lg border border-border bg-surface-soft">
              <p className="text-sm text-text-secondary">
                <strong className="text-text font-semibold">Draft — not in effect.</strong>{" "}
                These terms are a work in progress and have not been reviewed by a lawyer. They do not create any legal obligations until a final version is published.
              </p>
            </div>

            <h1 className="text-heading mb-2">Terms of Service</h1>
            <PolicyMeta version={TERMS_VERSION} />

            <div className="flex flex-col gap-10 text-text">
              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Who can use this site</h2>
                <p className="text-text-secondary leading-relaxed">
                  You must be at least 18 years old to create an account or use this site. Children under 18 do not create accounts. A parent or guardian may create an account to manage lesson bookings on behalf of a child, and by doing so they accept these terms on that child&apos;s behalf. If you are under 18, do not attempt to create an account — ask a parent or guardian to do it for you.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Account responsibilities</h2>
                <p className="text-text-secondary leading-relaxed mb-3">
                  You are responsible for keeping your account credentials secure and for all activity that occurs under your account. Provide accurate information when creating your account and keep it up to date.
                </p>
                <p className="text-text-secondary leading-relaxed">
                  Do not share your account with others or allow anyone else to access your account. If you believe your account has been compromised, contact us immediately.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Acceptable use</h2>
                <p className="text-text-secondary leading-relaxed mb-3">
                  Use this site only for its intended purpose: booking and managing private swimming lessons with Coach Jason. You agree not to:
                </p>
                <ul className="flex flex-col gap-2 text-text-secondary list-disc list-inside leading-relaxed">
                  <li>Provide false information or impersonate another person</li>
                  <li>Attempt to gain unauthorized access to other accounts or site systems</li>
                  <li>Use the site for any unlawful purpose</li>
                  <li>Interfere with the operation of the site</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Lessons, payments, and refunds</h2>
                <p className="text-text-secondary leading-relaxed mb-3">
                  All lessons are private one-on-one sessions with Coach Jason. Lesson scheduling, cancellation, and rescheduling are subject to Coach Jason&apos;s availability.
                </p>
                <p className="text-text-secondary leading-relaxed">
                  Payments, prepaid balance, package credit, cancellations, and refunds are covered by our{" "}
                  <a href="/refund-policy" className="text-link underline hover:text-link-hover">
                    Payments &amp; Refund Policy
                  </a>
                  , which is part of these Terms.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Account suspension or termination</h2>
                <p className="text-text-secondary leading-relaxed">
                  [Business name] reserves the right to suspend or terminate accounts that violate these terms, provide false information, or engage in behavior that disrupts the site or other users. You may close your account at any time by contacting us.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Limitation of liability</h2>
                <p className="text-text-secondary leading-relaxed">
                  [Liability terms to be completed.]
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Changes to these terms</h2>
                <p className="text-text-secondary leading-relaxed">
                  We may update these terms, the Privacy Policy, or the Payments &amp; Refund Policy from time to time. When we do, we bump the version shown at the top of each page. The next time you book a lesson or add funds, we&apos;ll ask you to accept the updated policies before proceeding.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Contact</h2>
                <p className="text-text-secondary leading-relaxed">
                  Questions about these terms can be sent to [contact email].
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
    </div>
  );
}
