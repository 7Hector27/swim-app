"use client";

import type { SwimmerProgressResponse } from "@swim-app/shared";
import { evaluateHrefFor } from "./helpers";

interface WhatToWorkOnProps {
  priorities: SwimmerProgressResponse["coachingPriorities"];
  swimmerId: string;
}

export default function WhatToWorkOn({ priorities, swimmerId }: WhatToWorkOnProps) {
  if (priorities.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2
        className="text-lg font-heading text-text"
        style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
      >
        What to work on next
      </h2>
      <ul className="flex flex-col gap-2">
        {priorities.slice(0, 3).map((priority) => (
          <li
            key={priority.targetSlug}
            className="flex flex-col gap-1 p-3 rounded-[var(--radius-card)]"
            style={{ backgroundColor: "var(--color-surface-soft)" }}
          >
            <a
              href={evaluateHrefFor(swimmerId, priority.targetSlug)}
              className="text-sm font-semibold hover:underline"
              style={{ color: "var(--color-link)" }}
            >
              {priority.targetName}
            </a>
            {priority.chain.length > 1 && (
              <p className="text-xs text-text-secondary flex items-center flex-wrap gap-x-1 gap-y-0.5">
                <span>Build:</span>
                {priority.chain.slice(1).map((entry, index, slice) => (
                  <span key={entry.slug} className="flex items-center gap-1">
                    <a
                      href={evaluateHrefFor(swimmerId, entry.slug)}
                      className="hover:underline"
                      style={{
                        color: entry.notAssessed
                          ? "var(--color-text-secondary)"
                          : "var(--color-link)",
                      }}
                    >
                      {entry.name}
                      {entry.notAssessed ? " (check this)" : ""}
                    </a>
                    {index < slice.length - 1 && (
                      <span aria-hidden="true" className="text-text-secondary">
                        ›
                      </span>
                    )}
                  </span>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
