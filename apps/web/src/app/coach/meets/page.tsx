import { redirect } from "next/navigation";

// ADR 036 Phase 8 Part B Stop 3 piece 6: meets moved onto the
// /coach/swimmers page as a tab. Old links and bookmarks keep
// working — this permanent redirect lands callers on the Meets tab
// with no client-side flash. The CoachMeetsContent component itself
// stays in place so any future caller that needs the full-chrome
// standalone view can still import it.
export default function CoachMeetsPage() {
  redirect("/coach/swimmers?tab=meets");
}
