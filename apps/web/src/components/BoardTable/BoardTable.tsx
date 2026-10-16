import type { PublicBoardRow, PublicMasterRow } from "@swim-app/shared";

interface BoardTableProps {
  rows: PublicBoardRow[] | PublicMasterRow[];
  showStandard?: boolean;
}

function formatStroke(stroke: string): string {
  if (stroke === "im") return "IM";
  const map: Record<string, string> = {
    free: "Free",
    back: "Back",
    breast: "Breast",
    fly: "Fly",
  };
  return map[stroke] ?? stroke;
}

function formatCourse(course: string): string {
  return course.toUpperCase();
}

function formatEvent(distance: number, stroke: string, course: string): string {
  return `${distance} ${formatStroke(stroke)} · ${formatCourse(course)}`;
}

function formatAgeGroup(ageGroup: string, sex: string): string {
  const sexLabel = sex === "female" ? "Female" : sex === "male" ? "Male" : sex;
  return `${ageGroup} · ${sexLabel}`;
}

function standardBadgeClass(standard: string): string {
  if (standard === "B" || standard === "BB") {
    return "text-text-secondary text-xs font-mono";
  }
  if (standard === "A" || standard === "AA") {
    return "text-text font-semibold text-xs font-mono";
  }
  return "text-accent font-semibold text-xs font-mono";
}

function isMasterRow(row: PublicBoardRow | PublicMasterRow): row is PublicMasterRow {
  return "standard" in row;
}

export default function BoardTable({ rows, showStandard = false }: BoardTableProps) {
  if (rows.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-text-secondary text-sm">
          No times match those filters — try adjusting your selection.
        </p>
      </div>
    );
  }

  return (
    <table className="w-full">
      <thead>
        <tr>
          <th className="text-left pb-3 pt-1 text-text-secondary font-semibold text-xs w-10">
            Rank
          </th>
          <th className="text-left pb-3 pt-1 text-text-secondary font-semibold text-xs">
            Swimmer
          </th>
          <th className="text-left pb-3 pt-1 text-text-secondary font-semibold text-xs whitespace-nowrap">
            Time
          </th>
          {showStandard && (
            <th className="text-left pb-3 pt-1 text-text-secondary font-semibold text-xs whitespace-nowrap">
              Standard
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} className="border-t border-border">
            <td className="py-3 w-10 text-accent font-heading font-bold text-sm tabular-nums align-top">
              {row.rank}
            </td>
            <td className="py-3 pr-3">
              <span className="text-text font-semibold text-sm">
                {row.firstName} {row.lastInitial}.
              </span>
              <span className="block text-text-secondary text-xs mt-0.5">
                {formatEvent(row.eventDistance, row.eventStroke, row.course)}
                {" · "}
                {formatAgeGroup(row.ageGroup, row.sex)}
              </span>
            </td>
            <td className="py-3 text-text text-sm tabular-nums align-top whitespace-nowrap">
              {row.time}
            </td>
            {showStandard && (
              <td className="py-3 align-top">
                {isMasterRow(row) && (
                  <span className={standardBadgeClass(row.standard)}>{row.standard}</span>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
