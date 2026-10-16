"use client";

interface Location {
  id: string;
  name: string;
  isHomePool: boolean;
}

interface Swimmer {
  id: string;
  firstName: string;
  lastName: string;
}

interface Props {
  locations: Location[];
  swimmers: Swimmer[];
  locationId: string | null;
  durationMinutes: 30 | 45 | 60;
  swimmerIds: string[];
  isLoading: boolean;
  onLocationChange: (id: string) => void;
  onDurationChange: (d: 30 | 45 | 60) => void;
  onSwimmersChange: (ids: string[]) => void;
}

const DURATIONS: Array<30 | 45 | 60> = [30, 45, 60];

const CHIP_BASE =
  "min-h-[36px] px-3 rounded-full border text-sm transition-colors duration-150 motion-reduce:transition-none disabled:opacity-40 disabled:cursor-default";

const CHIP_ACTIVE = "border-accent text-accent bg-accent/10";
const CHIP_INACTIVE = "border-border text-text hover:bg-surface-soft";

export default function CalendarConfigRow({
  locations,
  swimmers,
  locationId,
  durationMinutes,
  swimmerIds,
  isLoading,
  onLocationChange,
  onDurationChange,
  onSwimmersChange,
}: Props) {
  function toggleSwimmer(id: string) {
    if (swimmerIds.includes(id)) {
      onSwimmersChange(swimmerIds.filter((existing) => existing !== id));
    } else {
      onSwimmersChange([...swimmerIds, id]);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {locations.length > 1 && (
        <>
          <select
            value={locationId ?? ""}
            onChange={(event) => onLocationChange(event.target.value)}
            disabled={isLoading}
            className={`${CHIP_BASE} appearance-none bg-background pr-7 cursor-pointer`}
            aria-label="Pool location"
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          <span className="w-px h-5 bg-border flex-shrink-0" aria-hidden="true" />
        </>
      )}

      {DURATIONS.map((minutes) => (
        <button
          key={minutes}
          type="button"
          onClick={() => onDurationChange(minutes)}
          disabled={isLoading}
          className={`${CHIP_BASE} ${durationMinutes === minutes ? CHIP_ACTIVE : CHIP_INACTIVE}`}
        >
          {minutes} min
        </button>
      ))}

      {swimmers.length > 0 && (
        <>
          <span className="w-px h-5 bg-border flex-shrink-0" aria-hidden="true" />
          {swimmers.map((swimmer) => {
            const isActive = swimmerIds.includes(swimmer.id);
            return (
              <button
                key={swimmer.id}
                type="button"
                onClick={() => toggleSwimmer(swimmer.id)}
                disabled={isLoading}
                aria-pressed={isActive}
                className={`${CHIP_BASE} ${isActive ? CHIP_ACTIVE : CHIP_INACTIVE}`}
              >
                {swimmer.firstName} {swimmer.lastName}
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
