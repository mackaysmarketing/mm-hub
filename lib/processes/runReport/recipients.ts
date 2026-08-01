/**
 * Pure parsing/validation for the report's recipient list — no I/O, no
 * `server-only`, so it can be imported from both the settings API route and
 * the "use client" Email reports tab without pulling server-only code into
 * the client bundle.
 *
 * Stored as one comma/semicolon-delimited string in
 * process_definitions.config.recipient_email (name kept singular —
 * renaming would need a data migration for no real benefit; a single
 * address with no delimiter still parses to a one-element list).
 */

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseRecipients(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export type RecipientValidation =
  | { valid: true; emails: string[] }
  | { valid: false; error: string };

export function validateRecipients(raw: string): RecipientValidation {
  const emails = parseRecipients(raw);
  if (emails.length === 0) {
    return { valid: false, error: "At least one recipient email is required" };
  }
  const invalid = emails.filter((e) => !EMAIL_SHAPE.test(e));
  if (invalid.length > 0) {
    return {
      valid: false,
      error: `Doesn't look like a valid email address: ${invalid.join(", ")}`,
    };
  }
  return { valid: true, emails };
}
