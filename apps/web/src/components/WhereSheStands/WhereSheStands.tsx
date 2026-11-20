import {
  averageToPct,
  averagesEqual,
  buildAriaLabel,
  laneIsRated,
  SCALE_LABELS,
  stretchTone,
  type Lane,
  type StretchTone,
} from "./helpers";

interface WhereSheStandsProps {
  lanes: ReadonlyArray<Lane>;
}

// Four-column breakdown of where the swimmer stands per skill group:
//   Group name | 1–5 track | Average | Skills rated
//
// Layout is driven by the component's own width via a container query
// (named `wss`), not the viewport, so the card adapts to its parent
// column at every page width. Thresholds:
//   - @min-[520px]/wss: full four-column layout.
//   - below that:       compact three-column (Skills rated hidden, the
//                       "N of M" count moves under the group name).
//   - @min-[440px]/wss: full scale labels ("1 Emerging", "3 Competent",
//                       "5 Mastery"). Below that: just the digits.
// The table itself sits inside an `overflow-x-auto` wrapper with a
// hard min-width, so the card never forces page-wide horizontal scroll —
// if the compact layout still doesn't fit, scrolling happens inside the
// card. The header/legend stay outside that wrapper so they're always
// fully visible.
export default function WhereSheStands({ lanes }: WhereSheStandsProps) {
  if (lanes.length === 0) return null;
  const ariaLabel = buildAriaLabel(lanes);

  return (
    <section
      className="@container/wss rounded-lg p-4 flex flex-col gap-3"
      style={{ backgroundColor: "var(--color-surface-soft)" }}
      aria-label={ariaLabel}
      data-testid="where-she-stands"
    >
      <div className="overflow-x-auto" data-testid="wss-scroll-wrapper">
        <table
          className="w-full text-sm min-w-[280px]"
          style={{ borderCollapse: "collapse" }}
        >
          <colgroup>
            <col style={{ width: "28%" }} />
            <col />
            <col style={{ width: "48px" }} />
            <col className="hidden @min-[520px]/wss:table-column" style={{ width: "72px" }} />
          </colgroup>
          <thead>
            <tr
              style={{ borderBottom: "1px solid var(--color-border)" }}
              data-testid="wss-header-row"
            >
              <th
                scope="col"
                className="text-left text-xs font-normal text-text-secondary py-2 pr-3 align-bottom"
              >
                Group
              </th>
              <th
                scope="col"
                className="py-2 px-3 align-bottom"
                aria-label="Average on a 1 to 5 scale"
              >
                <div className="flex justify-between text-xs text-text-secondary" data-testid="wss-scale-labels">
                  <ScaleLabel digit="1" full={SCALE_LABELS[0]} />
                  <ScaleLabel digit="3" full={SCALE_LABELS[1]} />
                  <ScaleLabel digit="5" full={SCALE_LABELS[2]} />
                </div>
              </th>
              <th
                scope="col"
                className="text-right text-xs font-normal text-text-secondary py-2 pl-3 align-bottom"
              >
                Average
              </th>
              <th
                scope="col"
                className="hidden @min-[520px]/wss:table-cell text-right text-xs font-normal text-text-secondary py-2 pl-3 align-bottom"
              >
                Skills rated
              </th>
            </tr>
          </thead>
          <tbody>
            {lanes.map((lane, index) => (
              <LaneRow key={lane.slug} lane={lane} isLast={index === lanes.length - 1} />
            ))}
          </tbody>
        </table>
      </div>
      <Legend />
    </section>
  );
}

// Scale-label slot that swaps between a bare digit and the full word as
// soon as the card is wide enough that "1 Emerging / 3 Competent / 5
// Mastery" no longer overlaps. `whitespace-nowrap` keeps "3 Competent"
// on one line even at the breakpoint boundary.
function ScaleLabel({ digit, full }: { digit: string; full: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="@min-[440px]/wss:hidden">{digit}</span>
      <span className="hidden @min-[440px]/wss:inline">{full}</span>
    </span>
  );
}

function LaneRow({ lane, isLast }: { lane: Lane; isLast: boolean }) {
  const rated = laneIsRated(lane);
  const rowBorderStyle = isLast ? undefined : { borderBottom: "1px solid var(--color-border)" };
  const nameFill = rated ? "var(--color-text)" : "var(--color-text-secondary)";

  if (!rated) {
    return (
      <tr
        style={rowBorderStyle}
        data-testid="wss-lane-row"
        data-slug={lane.slug}
        data-rated="false"
      >
        <td className="py-3 pr-3 align-middle" style={{ color: nameFill }}>
          {lane.name}
        </td>
        <td className="py-3 px-3 align-middle">
          <NotRatedTrack />
        </td>
        {/* Compact (<520px): "Not rated yet" lives in the Average slot
            alone, since Skills rated is hidden there. Wide (>=520px):
            the same message spans Average + Skills rated. */}
        <td
          className="@min-[520px]/wss:hidden text-right py-3 pl-3 align-middle text-text-secondary text-xs"
          data-testid="wss-lane-not-rated-phone"
        >
          Not rated yet
        </td>
        <td
          colSpan={2}
          className="hidden @min-[520px]/wss:table-cell text-right py-3 pl-3 align-middle text-text-secondary text-xs"
          data-testid="wss-lane-not-rated-desktop"
        >
          Not rated yet
        </td>
      </tr>
    );
  }

  const avgText = lane.currentAverage !== null ? lane.currentAverage.toFixed(1) : "—";
  const ratedText = `${lane.currentAssessedCount} of ${lane.totalCount}`;

  return (
    <tr
      style={rowBorderStyle}
      data-testid="wss-lane-row"
      data-slug={lane.slug}
      data-rated="true"
    >
      <td className="py-3 pr-3 align-middle" style={{ color: nameFill }}>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="truncate">{lane.name}</span>
          {/* Compact (<520px): "Skills rated" moves under the name.
              The count never wraps — "6 of 7" is treated as one token. */}
          <span
            className="@min-[520px]/wss:hidden text-xs text-text-secondary whitespace-nowrap"
            data-testid="wss-lane-rated-phone"
          >
            {ratedText}
          </span>
        </div>
      </td>
      <td className="py-3 px-3 align-middle">
        <Track lane={lane} />
      </td>
      <td
        className="text-right py-3 pl-3 align-middle font-medium tabular-nums"
        data-testid="wss-lane-average"
      >
        {avgText}
      </td>
      <td
        className="hidden @min-[520px]/wss:table-cell text-right py-3 pl-3 align-middle text-text-secondary tabular-nums text-sm whitespace-nowrap"
        data-testid="wss-lane-rated-desktop"
      >
        {ratedText}
      </td>
    </tr>
  );
}

// ── Track + markers ──────────────────────────────────────────────────────

function Track({ lane }: { lane: Lane }) {
  const first = lane.firstAverage;
  const current = lane.currentAverage;
  const tone: StretchTone = stretchTone(lane);
  const equal = averagesEqual(first, current);

  const firstPct = first !== null ? averageToPct(first) : null;
  const currentPct = current !== null ? averageToPct(current) : null;

  // Stretch: when both markers exist and tone !== "flat"/"none", fill the
  // segment between them. Accent for improvement, neutral for regression.
  const stretchStyle =
    firstPct !== null && currentPct !== null && tone !== "flat" && tone !== "none"
      ? (() => {
          const left = Math.min(firstPct, currentPct);
          const width = Math.abs(currentPct - firstPct);
          const bg = tone === "up" ? "var(--color-accent)" : "var(--color-text-secondary)";
          return { left: `${left}%`, width: `${width}%`, backgroundColor: bg };
        })()
      : null;

  return (
    <div
      className="relative"
      style={{ height: "20px" }}
      role="presentation"
      data-testid="wss-track"
      data-tone={tone}
    >
      {/* Baseline track: full width at 6px tall, rounded, neutral color. */}
      <div
        className="absolute left-0 right-0 top-1/2 -translate-y-1/2 rounded-full"
        style={{ height: "6px", backgroundColor: "var(--color-border)" }}
      />
      {stretchStyle && (
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full"
          style={{ height: "6px", ...stretchStyle }}
          data-testid="wss-track-stretch"
          data-tone={tone}
        />
      )}
      {/* Ring at the first-evaluation position. Skip when first === current
          so the ring doesn't overlap the dot. */}
      {firstPct !== null && !equal && (
        <span
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 pointer-events-none"
          style={{
            left: `${firstPct}%`,
            width: "10px",
            height: "10px",
            backgroundColor: "var(--color-surface-soft)",
            borderColor: "var(--color-text)",
          }}
          data-testid="wss-marker-ring"
          data-slug={lane.slug}
          data-pct={firstPct.toFixed(2)}
        />
      )}
      {/* Filled dot at the current position. */}
      {currentPct !== null && (
        <span
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
          style={{
            left: `${currentPct}%`,
            width: "14px",
            height: "14px",
            backgroundColor: "var(--color-accent)",
          }}
          data-testid="wss-marker-dot"
          data-slug={lane.slug}
          data-pct={currentPct.toFixed(2)}
        />
      )}
    </div>
  );
}

function NotRatedTrack() {
  return (
    <div
      className="relative"
      style={{ height: "20px" }}
      role="presentation"
      data-testid="wss-track"
      data-tone="not-rated"
    >
      <div
        className="absolute left-0 right-0 top-1/2 -translate-y-1/2 rounded-full"
        style={{
          height: "6px",
          backgroundImage:
            "repeating-linear-gradient(to right, var(--color-border) 0, var(--color-border) 4px, transparent 4px, transparent 8px)",
        }}
        data-testid="wss-track-not-rated"
      />
    </div>
  );
}

function Legend() {
  return (
    <div
      className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-secondary"
      data-testid="wss-legend"
    >
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="inline-block rounded-full border-2"
          style={{
            width: "10px",
            height: "10px",
            backgroundColor: "var(--color-surface-soft)",
            borderColor: "var(--color-text)",
          }}
        />
        First evaluation
      </span>
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="inline-block rounded-full"
          style={{ width: "14px", height: "14px", backgroundColor: "var(--color-accent)" }}
        />
        Now
      </span>
    </div>
  );
}
