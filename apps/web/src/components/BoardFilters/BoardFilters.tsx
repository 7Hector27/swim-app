"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

const distanceOptions = [
  { value: "", label: "All distances" },
  { value: "25", label: "25" },
  { value: "50", label: "50" },
  { value: "100", label: "100" },
  { value: "200", label: "200" },
  { value: "400", label: "400" },
  { value: "500", label: "500" },
  { value: "800", label: "800" },
  { value: "1000", label: "1000" },
  { value: "1500", label: "1500" },
  { value: "1650", label: "1650" },
];

const strokeOptions = [
  { value: "", label: "All strokes" },
  { value: "free", label: "Freestyle" },
  { value: "back", label: "Backstroke" },
  { value: "breast", label: "Breaststroke" },
  { value: "fly", label: "Butterfly" },
  { value: "im", label: "Individual Medley" },
];

const courseOptions = [
  { value: "", label: "All courses" },
  { value: "scy", label: "SCY" },
  { value: "scm", label: "SCM" },
  { value: "lcm", label: "LCM" },
];

const ageGroupOptions = [
  { value: "", label: "All ages" },
  { value: "6-under", label: "6 & Under" },
  { value: "7-8", label: "7-8" },
  { value: "9-10", label: "9-10" },
  { value: "11-12", label: "11-12" },
  { value: "13-14", label: "13-14" },
  { value: "15-18", label: "15-18" },
];

const sexOptions = [
  { value: "", label: "All" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
];

const selectClass =
  "rounded-button bg-card text-text-on-section text-sm px-3 h-10 border border-divider-section focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] appearance-none pr-8 cursor-pointer";

interface FilterSelectProps {
  label: string;
  paramKey: string;
  options: { value: string; label: string }[];
  currentValue: string;
  onChangeParam: (key: string, value: string) => void;
}

function FilterSelect({ label, paramKey, options, currentValue, onChangeParam }: FilterSelectProps) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={currentValue}
        onChange={(event) => onChangeParam(paramKey, event.target.value)}
        className={selectClass}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
        className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary-on-section"
      >
        <path
          d="M2 4l4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export default function BoardFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleParamChange(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === "") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    const queryString = next.toString();
    router.push(`${pathname}${queryString ? `?${queryString}` : ""}`);
  }

  return (
    <div className="flex flex-wrap gap-2 tablet:gap-3">
      <FilterSelect
        label="Distance"
        paramKey="eventDistance"
        options={distanceOptions}
        currentValue={searchParams.get("eventDistance") ?? ""}
        onChangeParam={handleParamChange}
      />
      <FilterSelect
        label="Stroke"
        paramKey="eventStroke"
        options={strokeOptions}
        currentValue={searchParams.get("eventStroke") ?? ""}
        onChangeParam={handleParamChange}
      />
      <FilterSelect
        label="Course"
        paramKey="course"
        options={courseOptions}
        currentValue={searchParams.get("course") ?? ""}
        onChangeParam={handleParamChange}
      />
      <FilterSelect
        label="Age group"
        paramKey="ageGroup"
        options={ageGroupOptions}
        currentValue={searchParams.get("ageGroup") ?? ""}
        onChangeParam={handleParamChange}
      />
      <FilterSelect
        label="Sex"
        paramKey="sex"
        options={sexOptions}
        currentValue={searchParams.get("sex") ?? ""}
        onChangeParam={handleParamChange}
      />
    </div>
  );
}
