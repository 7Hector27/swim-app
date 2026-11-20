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
// Each data row is rendered as a single `<tr>` carrying one bottom
// border, so the divider under every row runs uninterrupted from the
// group name through to the last column. The header row shares the
// same table so the column widths stay aligned across rows.
//
// Phone (≤768px): the "Skills rated" column is hidden and that cell's
// content ("N of M") moves under the group name as a subtitle. On a
// not-rated row the "Not rated yet" cell spans the two trailing
// columns on tablet+ and sits in the Average slot alone on phone.
export default function WhereSheStands({ lanes }: WhereSheStandsProps) {
  if (lanes.length === 0) return null;
  const ariaLabel = buildAriaLabel(lanes);

  return (
    <section
      className="rounded-lg p-4 flex flex-col gap-3"
      style={{ backgroundColor: "var(--color-surface-soft)" }}
      aria-label={ariaLabel}
      data-testid="where-she-stands"
    >
      <table
        className="w-full text-sm"
        style={{ borderCollapse: "collapse" }}
      >
        <colgroup>
          <col style={{ width: "28%" }} />
          <col />
          <col style={{ width: "48px" }} />
          <col className="hidden tablet:table-column" style={{ width: "72px" }} />
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
                <span>{SCALE_LABELS[0]}</span>
                <span>{SCALE_LABELS[1]}</span>
                <span>{SCALE_LABELS[2]}</span>
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
              className="hidden tablet:table-cell text-right text-xs font-normal text-text-secondary py-2 pl-3 align-bottom"
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
      <Legend />
    </section>
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
        {/* Tablet+: "Not rated yet" spans Average + Skills rated (two
            cells collapsed into one). Phone: Skills rated is hidden, so
            the message lives in the Average slot alone. */}
        <td
          className="tablet:hidden text-right py-3 pl-3 align-middle text-text-secondary text-xs"
          data-testid="wss-lane-not-rated-phone"
        >
          Not rated yet
        </td>
        <td
          colSpan={2}
          className="hidden tablet:table-cell text-right py-3 pl-3 align-middle text-text-secondary text-xs"
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
          {/* Phone-only subtitle: "Skills rated" moves under the name. */}
          <span
            className="tablet:hidden text-xs text-text-secondary"
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
        className="hidden tablet:table-cell text-right py-3 pl-3 align-middle text-text-secondary tabular-nums text-sm"
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
