import { PAYMENTS_REFUND_VERSION } from "@swim-app/shared";

import PolicyMeta from "@/components/PolicyMeta";

export default function RefundPolicyContent() {
  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 px-page py-16">
        <div className="mx-auto max-w-content">
          <div className="max-w-2xl">
            <div className="mb-8 px-4 py-3 rounded-lg border border-border bg-surface-soft">
              <p className="text-sm text-text-secondary">
                <strong className="text-text font-semibold">Draft — not in effect.</strong>{" "}
                This policy is a work in progress and has not been reviewed by a lawyer. It does not create any legal obligations until a final version is published.
              </p>
            </div>

            <h1 className="text-heading mb-2">Payments, Credit, and Refunds</h1>
            <PolicyMeta version={PAYMENTS_REFUND_VERSION} />

            <div className="flex flex-col gap-10 text-text">
              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Your prepaid balance</h2>
                <p className="text-text-secondary leading-relaxed">
                  Your family has one prepaid balance in your account. Every lesson comes out of it, and every refund goes back into it. You add to it with a credit or debit card.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">What a lesson costs</h2>
                <p className="text-text-secondary leading-relaxed mb-3">
                  A private lesson is <strong className="text-text">$120 an hour</strong>, billed by the minute:
                </p>
                <ul className="flex flex-col gap-2 text-text-secondary list-disc list-inside leading-relaxed mb-3">
                  <li>30 minutes — $60</li>
                  <li>45 minutes — $90</li>
                  <li>60 minutes — $120</li>
                </ul>
                <p className="text-text-secondary leading-relaxed mb-3">
                  Lessons with more than one swimmer from the same family are cheaper per swimmer. The hourly rate is:
                </p>
                <ul className="flex flex-col gap-2 text-text-secondary list-disc list-inside leading-relaxed">
                  <li>2 swimmers — $180 an hour</li>
                  <li>3 swimmers — $198 an hour</li>
                  <li>4 swimmers — $216 an hour</li>
                </ul>
                <p className="text-text-secondary leading-relaxed mt-3">
                  The booking screen always shows the exact price before you confirm.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Packages and bonus credit</h2>
                <p className="text-text-secondary leading-relaxed mb-3">
                  Buying a package gives you more lesson credit than it costs. The extra is a bonus we add on top of what you paid.
                </p>
                <ul className="flex flex-col gap-2 text-text-secondary list-disc list-inside leading-relaxed">
                  <li>
                    <strong className="text-text">Cannonball</strong> — 10 hours of lessons for 10% off.
                  </li>
                  <li>
                    <strong className="text-text">Deep End</strong> — 20 hours of lessons for 20% off.
                  </li>
                </ul>
                <p className="text-text-secondary leading-relaxed mt-3">
                  See <em>If you ask for your unused money back</em> below for how the bonus is treated if you later ask for a refund.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Credit never expires</h2>
                <p className="text-text-secondary leading-relaxed">
                  Whatever is on your balance stays there until you spend it or ask for it back.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Prices are locked at booking</h2>
                <p className="text-text-secondary leading-relaxed">
                  The price shown when you book is the price you&apos;re charged, and it&apos;s also the amount refunded if that lesson is later cancelled — even if Jason&apos;s rates change in between.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Booking needs enough balance</h2>
                <p className="text-text-secondary leading-relaxed">
                  If your balance isn&apos;t enough for a lesson, the booking screen walks you through adding exactly the shortfall or buying a package. No surprise charges, and your balance can&apos;t go negative.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Cancellations, declines, no-shows: full refund, any time</h2>
                <p className="text-text-secondary leading-relaxed">
                  If you cancel, if Jason declines or cancels on his side, if a lesson is marked no-show, or if a pending request expires without approval — the full lesson price goes back onto your balance. No cutoff window. No fee.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Jason can adjust your balance</h2>
                <p className="text-text-secondary leading-relaxed">
                  If Jason credits or debits your balance by hand — for example to credit an off-platform payment or fix a mistake — your balance history shows the amount, the time, and the reason he typed.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">If you ask for your unused money back</h2>
                <p className="text-text-secondary leading-relaxed mb-3">
                  You can ask Jason to refund your leftover credit to your card at any time. We treat the lessons you&apos;ve already taken as if you had paid regular (non-package) prices for them; whatever&apos;s left of what you actually paid comes back to your card. <strong className="text-text">Bonus credit from a package, and any credit Jason added as a gift, aren&apos;t cash and aren&apos;t returned</strong> — they&apos;re forfeited on cash-out.
                </p>
                <p className="text-text-secondary leading-relaxed">
                  <em>Worked example.</em> You buy the Deep End package for $1,920 (which puts $2,400 of credit on your balance) and take $480 of lessons. $480 of lessons at regular prices means <strong className="text-text">$1,440 refunded to your card</strong>. The remaining $480 on your balance was package bonus and is forfeited.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Refunds on account deletion</h2>
                <p className="text-text-secondary leading-relaxed">
                  When you delete your account, any leftover money is refunded to your card automatically using the same rule above. If a card charge is older than Stripe&apos;s 180-day refund window, Jason will contact you to arrange the refund by hand.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">How payments are handled</h2>
                <p className="text-text-secondary leading-relaxed">
                  Card payments go through <strong className="text-text">Stripe</strong>. Your card number, CVV, and expiry are entered on Stripe&apos;s own pages — we never see them, store them, or log them. Stripe sends you a receipt by email for every top-up or package purchase.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-bold text-heading mb-3">Questions</h2>
                <p className="text-text-secondary leading-relaxed">
                  Email Jason at [contact email] for anything about charges, refunds, or your balance.
                </p>
              </section>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
