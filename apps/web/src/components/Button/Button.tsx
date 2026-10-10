import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline";
}

export default function Button({
  variant = "primary",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-button font-bold text-sm min-h-[52px] px-7 transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed";

  const variants: Record<string, string> = {
    primary: "bg-button-primary-background text-button-primary-text active:scale-[0.97]",
    outline:
      "border-2 border-button-outline text-button-outline active:scale-[0.97]",
  };

  return (
    <button className={`${base} ${variants[variant] ?? ""} ${className}`} {...rest}>
      {children}
    </button>
  );
}
