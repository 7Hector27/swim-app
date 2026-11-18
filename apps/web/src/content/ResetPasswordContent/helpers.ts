// Plain module (no "use server" / "use client" directive): shared by the
// Reset-password client component and its server action. Password-rule
// copy stays co-located with the PasswordSchema import so it rots
// together.

import { PASSWORD_MIN_LENGTH } from "@swim-app/shared";

export const PASSWORD_RULE_HELP = `Must be at least ${PASSWORD_MIN_LENGTH} characters.`;
