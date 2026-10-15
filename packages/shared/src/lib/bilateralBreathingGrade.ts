// Calculates the bilateral breathing rollup grade from left and right
// freestyle breath timing grades.
//
// Returns the weaker (lower) of the two sides. Returns null if either
// side has not been assessed yet.
//
// confirm with Jason: whether one side absent should fall back to the other.
export function calculateBilateralBreathingGrade(
  leftGrade: number | null,
  rightGrade: number | null,
): number | null {
  if (leftGrade === null || rightGrade === null) return null;
  return Math.min(leftGrade, rightGrade);
}
