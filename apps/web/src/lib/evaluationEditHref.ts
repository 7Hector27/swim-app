// ADR 032: edit-mode deep link builder. Lives in a plain module (no "use
// client") so client components can import it directly. Server components
// pass only the serializable context — swimmerId, returnTo, optional skill
// slug — and the client builds the href. Keeps function props off the
// server-to-client boundary, which Next.js disallows.
export interface EvaluationEditContext {
  swimmerId: string;
  returnTo: string;
  // When set, the href carries ?skill=<slug> so the evaluate page scrolls
  // to that skill after loading.
  skillSlug?: string;
}

export function evaluationEditHref(
  context: EvaluationEditContext,
  sessionId: string,
): string {
  const base = `/coach/swimmers/${context.swimmerId}/evaluate?editSession=${encodeURIComponent(
    sessionId,
  )}&returnTo=${encodeURIComponent(context.returnTo)}`;
  return context.skillSlug !== undefined
    ? `${base}&skill=${encodeURIComponent(context.skillSlug)}`
    : base;
}
