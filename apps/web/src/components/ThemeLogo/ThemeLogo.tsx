import Image from "next/image";

import styles from "./ThemeLogo.module.css";

interface ThemeLogoProps {
  /** "lockup" shows the full wordmark (default). "emblem" shows the square mark only.
   *  "auto" shows the lockup on tablet+ and the emblem on mobile. */
  variant?: "lockup" | "emblem" | "auto";
  alt?: string;
  className?: string;
  width?: number;
  height?: number;
}

export default function ThemeLogo({
  variant = "lockup",
  alt = "Axiom Aquatics",
  className,
  width,
  height,
}: ThemeLogoProps) {
  if (variant === "emblem") {
    return (
      <Image
        src="/logos/axiom-aquatics-emblem.webp"
        alt={alt}
        width={width ?? 40}
        height={height ?? 40}
        className={className}
      />
    );
  }

  if (variant === "auto") {
    return (
      <span className={`inline-flex ${className ?? ""}`}>
        {/* Emblem on mobile */}
        <Image
          src="/logos/axiom-aquatics-emblem.webp"
          alt={alt}
          width={40}
          height={40}
          className="tablet:hidden"
        />
        {/* Lockup on tablet+ — light/dark variants */}
        <span className={styles.lockupWrap}>
          <Image
            src="/logos/axiom-aquatics-lockup.webp"
            alt={alt}
            width={width ?? 140}
            height={height ?? 40}
            className={`hidden tablet:block ${styles.light}`}
          />
          <Image
            src="/logos/axiom-aquatics-lockup-dark.webp"
            alt=""
            aria-hidden
            width={width ?? 140}
            height={height ?? 40}
            className={`hidden tablet:block ${styles.dark}`}
          />
        </span>
      </span>
    );
  }

  // Default: lockup with theme-aware light/dark swap
  return (
    <span className={`inline-flex ${className ?? ""}`}>
      <Image
        src="/logos/axiom-aquatics-lockup.webp"
        alt={alt}
        width={width ?? 140}
        height={height ?? 40}
        className={styles.light}
      />
      <Image
        src="/logos/axiom-aquatics-lockup-dark.webp"
        alt=""
        aria-hidden
        width={width ?? 140}
        height={height ?? 40}
        className={styles.dark}
      />
    </span>
  );
}
