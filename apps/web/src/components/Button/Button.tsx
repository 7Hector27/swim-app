import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

type Variant = "primary" | "outline";

type ButtonAsButton = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  href?: undefined;
};

type ButtonAsAnchor = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: Variant;
  href: string;
};

type ButtonProps = ButtonAsButton | ButtonAsAnchor;

// Base + variant class contract. Shared across both the <button> and <a>
// polymorphs so a styling tweak lands in one place.
const BASE_CLASSES =
  "inline-flex items-center justify-center rounded-button font-bold text-sm min-h-[52px] px-7 transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-button-primary-background text-button-primary-text active:scale-[0.97]",
  outline: "border-2 border-button-outline text-button-outline active:scale-[0.97]",
};

export default function Button(props: ButtonProps) {
  const { variant = "primary", className = "", children } = props;
  const merged = `${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${className}`;

  // Polymorph to <a> when href is present so link callers (e.g. "Request
  // a new link" on /auth/reset-password) share the exact button visual
  // contract without duplicating the class list.
  if (props.href !== undefined) {
    const { variant: _variant, className: _className, children: _children, ...anchorProps } = props;
    return (
      <a className={merged} {...anchorProps}>
        {children}
      </a>
    );
  }

  const { variant: _variant, className: _className, children: _children, ...buttonProps } = props;
  return (
    <button className={merged} {...buttonProps}>
      {children}
    </button>
  );
}
