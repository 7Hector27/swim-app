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
    <div className="flex flex-col gap-4">
      {locations.length > 1 && (
        <fieldset disabled={isLoading}>
          <legend className="text-sm font-semibold text-text mb-2">Pool</legend>
          <div className="flex flex-wrap gap-2">
            {locations.map((location) => (
              <button
                key={location.id}
                type="button"
                onClick={() => onLocationChange(location.id)}
                disabled={isLoading}
                className={`min-h-[44px] px-4 rounded-button border text-sm transition-colors duration-150 ${
                  locationId === location.id
                    ? "border-accent text-accent bg-accent/10"
                    : "border-border text-text hover:bg-surface-soft"
                }`}
              >
                {location.name}
                {location.isHomePool && (
                  <span className="ml-1.5 text-xs text-text-secondary">(home)</span>
                )}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset disabled={isLoading}>
        <legend className="text-sm font-semibold text-text mb-2">Duration</legend>
        <div className="flex gap-2">
          {DURATIONS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => onDurationChange(minutes)}
              disabled={isLoading}
              className={`min-h-[44px] px-4 rounded-button border text-sm transition-colors duration-150 ${
                durationMinutes === minutes
                  ? "border-accent text-accent bg-accent/10"
                  : "border-border text-text hover:bg-surface-soft"
              }`}
            >
              {minutes} min
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={isLoading}>
        <legend className="text-sm font-semibold text-text mb-2">Swimmers</legend>
        <div className="flex flex-col gap-2">
          {swimmers.map((swimmer) => (
            <label
              key={swimmer.id}
              className="flex items-center gap-3 cursor-pointer min-h-[44px]"
            >
              <input
                type="checkbox"
                checked={swimmerIds.includes(swimmer.id)}
                onChange={() => toggleSwimmer(swimmer.id)}
                disabled={isLoading}
                className="accent-accent w-4 h-4"
              />
              <span className="text-sm text-text">
                {swimmer.firstName} {swimmer.lastName}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
