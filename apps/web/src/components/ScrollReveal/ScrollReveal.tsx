"use client";

import { useEffect, useRef } from "react";

import styles from "./ScrollReveal.module.css";

interface ScrollRevealProps {
  children: React.ReactNode;
  delay?: number;
  mobileStagger?: boolean;
  className?: string | undefined;
}

export default function ScrollReveal({
  children,
  delay = 0,
  mobileStagger = true,
  className,
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          element.dataset.visible = "true";
          observer.disconnect();
        }
      },
      { rootMargin: "-50px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const classNames = [
    styles.root,
    !mobileStagger ? styles.noMobileDelay : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={ref}
      className={classNames}
      style={{ "--reveal-delay": `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
