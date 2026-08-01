/**
 * Minimal Resend client — a raw fetch against Resend's REST API rather than
 * the `resend` npm package, consistent with this repo's existing style of
 * hand-typed API clients over generated/SDK ones (see
 * lib/freshtrack-graphql.ts). One endpoint, one call — a dependency wasn't
 * worth it.
 *
 * Requires RESEND_API_KEY and RESEND_FROM_EMAIL in the environment. Neither
 * exists in this codebase yet — see README/handoff notes for what needs
 * adding in Vercel before any report can actually send.
 */
import "server-only";

export class ResendConfigError extends Error {}
export class ResendSendError extends Error {}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export interface SendEmailResult {
  id: string;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey) {
    throw new ResendConfigError("RESEND_API_KEY is not set");
  }
  if (!from) {
    throw new ResendConfigError("RESEND_FROM_EMAIL is not set");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ResendSendError(
      `Resend API ${res.status}: ${body.slice(0, 500) || res.statusText}`
    );
  }

  const data = (await res.json()) as { id: string };
  return { id: data.id };
}
