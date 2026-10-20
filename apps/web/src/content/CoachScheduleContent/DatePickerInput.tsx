"use client";

import { useRouter } from "next/navigation";

interface Props {
  date: string;
}

export default function DatePickerInput({ date }: Props) {
  const router = useRouter();
  return (
    <input
      type="date"
      value={date}
      aria-label="Jump to date"
      onChange={(event) => {
        if (event.target.value) router.push(`?view=day&date=${event.target.value}`);
      }}
      className="h-11 px-3 rounded-button border border-border bg-background text-text text-sm focus:outline focus:outline-2 focus:outline-focus-ring"
    />
  );
}
