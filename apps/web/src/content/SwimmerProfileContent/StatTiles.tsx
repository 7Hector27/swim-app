import { formatRelativeDay } from "./helpers";

interface StatTilesProps {
  age: number;
  lastEvalDate: string | null;
  progressFailed: boolean;
  upcomingCount: number | null;
  isPublic: boolean;
}

export default function StatTiles({
  age,
  lastEvalDate,
  progressFailed,
  upcomingCount,
  isPublic,
}: StatTilesProps) {
  return (
    <section className="grid grid-cols-2 tablet:grid-cols-4 desktop:grid-cols-2 gap-3">
      <StatTile label="Age" value={String(age)} />
      <StatTile
        label="Last evaluated"
        value={
          progressFailed
            ? "Couldn't load"
            : lastEvalDate
              ? formatRelativeDay(lastEvalDate)
              : "No evaluations yet"
        }
      />
      <StatTile
        label="Upcoming"
        value={upcomingCount === null ? "Couldn't load" : String(upcomingCount)}
        {...(upcomingCount !== null && {
          suffix: upcomingCount === 1 ? "lesson" : "lessons",
        })}
      />
      <StatTile label="Leaderboards" value={isPublic ? "On" : "Off"} />
    </section>
  );
}

interface StatTileProps {
  label: string;
  value: string;
  suffix?: string;
}

function StatTile({ label, value, suffix }: StatTileProps) {
  return (
    <div className="rounded-card border border-border p-4">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className="font-heading text-xl text-heading leading-none mt-1.5">
        {value}
        {suffix ? (
          <span className="font-body text-xs font-normal text-text-secondary ml-1.5">
            {suffix}
          </span>
        ) : null}
      </p>
    </div>
  );
}
