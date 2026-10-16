"use client";

import { useState } from "react";

interface EvalSectionHeaderProps {
  name: string;
  skillCount: number;
  children: React.ReactNode;
}

export default function EvalSectionHeader({ name, skillCount, children }: EvalSectionHeaderProps) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between py-2 text-left"
        style={{ borderBottom: "1px solid var(--color-border)", background: "none" }}
      >
        <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          {name}
          <span className="ml-2 font-normal text-xs" style={{ color: "var(--color-text-secondary)" }}>
            ({skillCount})
          </span>
        </span>
        <span className="text-xs" style={{ color: "var(--color-text-secondary)" }} aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && <div className="flex flex-col gap-4 pt-3">{children}</div>}
    </div>
  );
}
