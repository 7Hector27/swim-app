import { describe, it, expect } from "vitest";
import { displayUnitToMeasurementEnum, INTENTIONALLY_UNMAPPED_CATALOG_UNITS } from "@swim-app/shared";
import { SKILLS_CATALOG } from "../db/reference/skillsCatalog";

describe("measurement unit catalog coverage", () => {
  it("every catalog unit label is either mapped to an enum or listed as intentionally unmapped", () => {
    const catalogUnits = new Set<string>();
    for (const category of SKILLS_CATALOG) {
      for (const skill of category.skills) {
        if (skill.unit !== undefined) catalogUnits.add(skill.unit);
      }
    }

    const uncategorized = [...catalogUnits].filter(
      (unit) =>
        displayUnitToMeasurementEnum(unit) === null &&
        !INTENTIONALLY_UNMAPPED_CATALOG_UNITS.has(unit),
    );

    expect(uncategorized).toEqual([]);
  });
});
