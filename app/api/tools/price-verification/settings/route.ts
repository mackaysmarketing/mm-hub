/**
 * GET   — current verification settings (any user with tool access).
 * PATCH — change them (hub_admin only).
 */
import { NextResponse } from "next/server";
import { checkToolAccess } from "@/lib/tools/access";
import { loadSettings, saveSettings } from "@/lib/priceVerification/settings";
import { TOOL_KEY, type VerificationSettings } from "@/lib/priceVerification/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await checkToolAccess(TOOL_KEY);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason ?? "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await loadSettings());
}

export async function PATCH(request: Request) {
  const access = await checkToolAccess(TOOL_KEY);
  if (!access.allowed || !access.session) {
    return NextResponse.json({ error: access.reason ?? "Forbidden" }, { status: 403 });
  }
  if (!access.isHubAdmin) {
    return NextResponse.json(
      { error: "Only a hub admin can change verification settings" },
      { status: 403 }
    );
  }

  let body: Partial<VerificationSettings>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Partial<VerificationSettings> = {};

  if (body.tolerance !== undefined) {
    const tolerance = Number(body.tolerance);
    if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 100) {
      return NextResponse.json(
        { error: "Tolerance must be between $0 and $100" },
        { status: 400 }
      );
    }
    patch.tolerance = tolerance;
  }

  if (body.verifiableStates !== undefined) {
    if (!Array.isArray(body.verifiableStates) || body.verifiableStates.length === 0) {
      return NextResponse.json(
        { error: "At least one order state must be verifiable" },
        { status: 400 }
      );
    }
    patch.verifiableStates = body.verifiableStates.map(String);
  }

  if (body.skipStates !== undefined) {
    if (!Array.isArray(body.skipStates)) {
      return NextResponse.json({ error: "skipStates must be a list" }, { status: 400 });
    }
    patch.skipStates = body.skipStates.map(String);
  }

  if (body.unapprovedQuotes !== undefined) {
    if (body.unapprovedQuotes !== "use" && body.unapprovedQuotes !== "skip") {
      return NextResponse.json(
        { error: 'unapprovedQuotes must be "use" or "skip"' },
        { status: 400 }
      );
    }
    patch.unapprovedQuotes = body.unapprovedQuotes;
  }

  // A state in both lists would make the outcome depend on evaluation order.
  const verifiable = patch.verifiableStates ?? (await loadSettings()).verifiableStates;
  const skip = patch.skipStates ?? (await loadSettings()).skipStates;
  const overlap = verifiable.filter((s) => skip.includes(s));
  if (overlap.length > 0) {
    return NextResponse.json(
      { error: `These states are both verifiable and skipped: ${overlap.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json(await saveSettings(patch, access.session.hubUser.id));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
