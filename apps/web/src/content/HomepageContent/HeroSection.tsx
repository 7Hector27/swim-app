"use client";

import Link from "next/link";

import { useSession } from "@/components/Providers";

import HeroBubbleBg from "./HeroBubbleBg";
import styles from "./HeroSection.module.css";

export default function HeroSection() {
  const { isSignedIn } = useSession();

  return (
    <section className="relative overflow-hidden bg-background">
      <HeroBubbleBg />
      <div className="relative mx-auto max-w-content px-page pt-20 pb-20 tablet:pt-28 tablet:pb-28 desktop:pt-36 desktop:pb-36">
        <div className="mx-auto max-w-3xl flex flex-col items-center text-center gap-6">
          <h1 className={`text-heading ${styles.heading}`}>
            Private swim lessons, one swimmer at a time.
          </h1>
          <p className={`text-text-secondary text-base tablet:text-lg max-w-lg ${styles.body}`}>
            Coach Jason teaches every lesson himself, one on one. Swimmers
            learning to float and club swimmers chasing a best time get the
            same full attention.
          </p>
          <div className={`mt-2 ${styles.ctas}`}>
            <Link
              href={isSignedIn ? "/dashboard" : "/signup"}
              className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold px-8 h-[52px] transition-opacity duration-200 hover:opacity-90 active:scale-[0.97]"
            >
              Book a lesson
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
