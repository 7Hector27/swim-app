# add-form skill

How to add a form page in this app. Uses AddSwimmerContent as the reference example.

## File layout

```
app/dashboard/swimmers/new/page.tsx       ← server component: auth check, fetch props, render content
content/AddSwimmerContent/
  AddSwimmerContent.tsx                   ← "use client"; useActionState form
  actions.ts                              ← "use server"; parse → validate → call API → return state
  helpers.ts                              ← AddSwimmerState type + mapApiResponse (pure, testable)
  index.ts                                ← export { default } from "./AddSwimmerContent"
__tests__/addSwimmerHelpers.test.ts       ← unit tests for helpers.ts only
```

## State type shape

```ts
// helpers.ts
export type AddSwimmerState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "field_errors"; errors: Record<string, string> };
```

`mapApiResponse(status, body)` maps API status codes to state. Never "success" — on success, the server action calls `redirect()`. Keep `mapApiResponse` pure (no imports from `next/`) so it's testable without mocks.

## Server action shape

```ts
// actions.ts
"use server";
export async function addSwimmer(_prev: AddSwimmerState, formData: FormData): Promise<AddSwimmerState> {
  // 1. Parse form fields from FormData
  // 2. Run CreateSwimmerBodySchema.safeParse(raw) — returns field_errors on failure
  // 3. Get Supabase session token; return error if missing
  // 4. fetch() the API; map status/body to state via mapApiResponse
  // 5. On 201: redirect("/dashboard") — must be outside any try/catch
}
```

Import `mapZodErrors` from `@/lib/mapZodErrors` for the Zod → `Record<string,string>` conversion.

## Form component

```tsx
// "use client"
const [state, formAction, isPending] = useActionState(addSwimmer, initialState);
const fieldErrors = state.status === "field_errors" ? state.errors : {};
```

Every `<input>` wires up `aria-describedby` conditionally:

```tsx
<input
  id="firstName"
  name="firstName"
  aria-describedby={fieldErrors["firstName"] ? "firstName-error" : undefined}
/>
<FieldError id="firstName-error" message={fieldErrors["firstName"]} />
```

`FieldError` lives in `components/FieldError/`. It renders null when `message` is undefined, so the DOM element with the error id only exists when there is an error — hence the conditional `aria-describedby`.

## Zod sharing

The server action imports `CreateSwimmerBodySchema` from `@swim-app/shared` and calls `.safeParse(raw)` on the assembled raw object. The client can import the same schema for inline validation if needed (not required — server validation is the real gate).

For schema methods without importing `z` directly: use schema methods like `ClubSchema.array().safeParse(body)` — Zod schema instances have `.array()`, `.safeParse()`, etc.

## Dynamic form fields (clubs)

Fields with dynamic state (multi-value checkboxes, "add another" lists) use controlled React state, not form inputs with names. A single hidden input carries the serialized value:

```tsx
const clubsJson = JSON.stringify([
  ...[...selectedClubIds].map(id => ({ clubId: id })),
  ...otherClubNames.filter(Boolean).map(name => ({ otherClubName: name })),
]);
<input type="hidden" name="clubsJson" value={clubsJson} />
```

The server action parses and re-validates the JSON with the Zod schema, so the serialization is only a transport detail.

## Required-before-submit fields

For a radio/select that blocks submission until picked (isPublic):

```tsx
const [isPublicValue, setIsPublicValue] = useState<"yes" | "no" | null>(null);
// ...
<Button disabled={isPublicValue === null || isPending}>Add swimmer</Button>
```

The server action still validates the field; the disabled button is only UX.

## Error mapping rules

| API status | Mapping |
|---|---|
| 400 | Fixed message (domain error, e.g. "club no longer available") |
| 422 + `issues[]` | `field_errors` via `mapZodErrors` |
| anything else | Generic "Something went wrong" |

Never surface raw API error text to the user.

## Accessibility checklist

- `<fieldset>` + `<legend>` for every radio/checkbox group
- `aria-describedby` on each input pointing to its `<FieldError id="...">` (only when error present)
- `role="alert"` on `<FieldError>` so screen readers announce it on appearance
- `role="alert"` + `aria-live="polite"` on top-level error banner
- Min tap target 44px on all interactive elements (`min-h-[44px]`)
- `noValidate` on `<form>` — browser validation is suppressed; all feedback comes from the server action

## Tests

Test `helpers.ts` only — it's the only file with logic worth unit-testing (pure function, no side effects). Server action and form component need integration/E2E tests.

```ts
import { describe, expect, it } from "vitest";
import { mapApiResponse } from "../content/AddSwimmerContent/helpers";
```
