import Image from "next/image";

import styles from "./ThemeLogo.module.css";

interface ThemeLogoProps {
  alt?: string;
  className?: string;
  width?: number;
  height?: number;
}

export default function ThemeLogo({
  alt = "JG Swim",
  className,
  width = 120,
  height = 48,
}: ThemeLogoProps) {
  return (
    <span className={className}>
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
