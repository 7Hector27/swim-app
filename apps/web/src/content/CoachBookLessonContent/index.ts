export { default } from "./CoachBookLessonContent";
// Pure helper exported from helpers.ts (no "use client" directive) so the
// server page at /coach/book can call it without pulling the client-only
// orchestrator into its render.
export { computeInitialSwimmerIds } from "./helpers";
