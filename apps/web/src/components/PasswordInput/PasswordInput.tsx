"use client";

import { forwardRef, useRef, useState } from "react";

function EyeIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, ...rest }, forwardedRef) {
    const [visible, setVisible] = useState(false);
    const innerRef = useRef<HTMLInputElement>(null);

    function handleToggle() {
      const input = innerRef.current;
      const start = input?.selectionStart ?? null;
      const end = input?.selectionEnd ?? null;
      setVisible((prev) => !prev);
      requestAnimationFrame(() => {
        if (input && start !== null && end !== null) {
          input.setSelectionRange(start, end);
        }
        input?.focus();
      });
    }

    return (
      <div className={`relative${className ? ` ${className}` : ""}`}>
        <input
          ref={(node) => {
            (innerRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
            if (typeof forwardedRef === "function") {
              forwardedRef(node);
            } else if (forwardedRef) {
              (forwardedRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
            }
          }}
          type={visible ? "text" : "password"}
          className="h-12 pl-4 pr-12 w-full rounded-lg border border-border bg-background text-text"
          {...rest}
        />
        <button
          type="button"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={handleToggle}
          className="absolute right-0 top-0 h-full min-w-[44px] flex items-center justify-center text-text-secondary hover:text-text"
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    );
  },
);

export default PasswordInput;
