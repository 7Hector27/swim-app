import Image from "next/image";

import styles from "./ThemeLogo.module.css";

interface ThemeLogoProps {
  alt?: string;
  className?: string;
  width?: number;
  height?: number;
  onSection?: boolean;
}

export default function ThemeLogo({
  alt = "JG Swim",
  className,
  width = 120,
  height = 48,
  onSection = false,
}: ThemeLogoProps) {
  return (
    <span className={`${onSection ? styles.onSection : ""} ${className ?? ""}`.trim()}>
      <Image
        src="/logos/jg-swim-emblem.webp"
        alt={alt}
        width={width}
        height={height}
        className={styles.light}
      />
      <Image
        src="/logos/jg-swim-emblem-dark.webp"
        alt=""
        aria-hidden
        width={width}
        height={height}
        className={styles.dark}
      />
    </span>
  );
}
