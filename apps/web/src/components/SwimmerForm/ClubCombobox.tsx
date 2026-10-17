"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { Club } from "@swim-app/shared";

interface ClubComboboxProps {
  clubs: Club[];
  value: string;
  onChange: (value: string) => void;
  describedBy?: string;
  inputId: string;
}

interface Option {
  id: string;
  label: string;
}

const OTHER_VALUE = "other";
const OTHER_LABEL = "Other (not listed)";

export default function ClubCombobox({
  clubs,
  value,
  onChange,
  describedBy,
  inputId,
}: ClubComboboxProps) {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const activeOptionRef = useRef<HTMLLIElement>(null);

  const options = useMemo<Option[]>(() => {
    const sorted = clubs
      .map((club): Option => ({ id: club.id, label: club.name }))
      .sort((first, second) => first.label.localeCompare(second.label));
    return [...sorted, { id: OTHER_VALUE, label: OTHER_LABEL }];
  }, [clubs]);

  const selectedLabel = useMemo(() => {
    if (value === "") return "";
    if (value === OTHER_VALUE) return OTHER_LABEL;
    return clubs.find((club) => club.id === value)?.name ?? "";
  }, [value, clubs]);

  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return options;
    return options.filter((option) => option.label.toLowerCase().includes(trimmed));
  }, [options, query]);

  const displayValue = isOpen ? query : selectedLabel;

  useEffect(() => {
    if (!isOpen) return;
    function handleOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setQuery("");
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [isOpen]);

  useEffect(() => {
    const element = activeOptionRef.current;
    if (isOpen && element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, isOpen]);

  function openList() {
    if (!isOpen) {
      setIsOpen(true);
      const selectedIndex = filtered.findIndex((option) => option.id === value);
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }
  }

  function selectOption(option: Option) {
    onChange(option.id);
    setIsOpen(false);
    setQuery("");
    setActiveIndex(-1);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        openList();
        return;
      }
      setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        openList();
        return;
      }
      setActiveIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === "Home" && isOpen) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End" && isOpen) {
      event.preventDefault();
      setActiveIndex(filtered.length - 1);
      return;
    }
    if (event.key === "Enter" && isOpen) {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) selectOption(option);
      return;
    }
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      setIsOpen(false);
      setQuery("");
      setActiveIndex(-1);
    }
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    setQuery(event.target.value);
    setIsOpen(true);
    setActiveIndex(0);
  }

  function handleBlur() {
    setIsOpen(false);
    setQuery("");
    setActiveIndex(-1);
  }

  const activeOption = isOpen && activeIndex >= 0 ? filtered[activeIndex] : undefined;
  const activeDescendantId = activeOption
    ? `${listboxId}-option-${activeOption.id}`
    : undefined;

  return (
    <div ref={containerRef} className="relative">
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendantId}
        aria-describedby={describedBy}
        value={displayValue}
        onChange={handleInputChange}
        onFocus={openList}
        onClick={openList}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder="Search for a club…"
        autoComplete="off"
        spellCheck={false}
        className="w-full h-11 rounded-[8px] border border-border bg-background text-text px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      />
      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Clubs"
          className="absolute left-0 right-0 top-full mt-1 z-10 max-h-60 overflow-auto rounded-[8px] border border-border bg-background shadow-lg"
        >
          {filtered.length === 0 ? (
            <li
              role="presentation"
              className="px-3 py-2 text-sm text-text-secondary"
            >
              No clubs match.
            </li>
          ) : (
            filtered.map((option, index) => {
              const isActive = index === activeIndex;
              const isSelected = value === option.id;
              return (
                <li
                  key={option.id}
                  id={`${listboxId}-option-${option.id}`}
                  ref={isActive ? activeOptionRef : null}
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`px-3 py-2 text-sm cursor-pointer min-h-[44px] flex items-center ${
                    isActive ? "bg-surface-soft text-text" : "text-text"
                  } ${isSelected ? "font-semibold" : ""}`}
                >
                  {option.label}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
