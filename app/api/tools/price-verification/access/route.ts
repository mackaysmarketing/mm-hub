/**
 * The admin section's backing routes — who inside Mackays Marketing can use
 * this tool.
 *
 * GET  — every internal user, with whether they currently have access.
 * POST — grant / revoke. hub_admin only, both ways.
 *
 * hub_admins are listed as always-allowed and cannot be revoked: they can grant
 * themselves access in one click anyway, so a revoke that appeared to work but
 * did nothing would be worse than refusing it.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkToolAccess, listGrantableUsers } from "@/lib/tools/access";
import { TOOL_KEY } from "@/lib/priceVerification/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await checkToolAccess(TOOL_KEY);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason ?? "Forbidden" }, { status: 403 });
  }
  if (!access.isHubAdmin) {
    return NextResponse.json(
      { error: "Only a hub admin can view tool access" },
      { status: 403 }
    );
  }

  return NextResponse.json({ users: await listGrantableUsers(TOOL_KEY) });
}

export async function POST(request: Request) {
  const access = await checkToolAccess(TOOL_KEY);
  if (!access.allowed || !access.session) {
    return NextResponse.json({ error: access.reason ?? "Forbidden" }, { status: 403 });
  }
  if (!access.isHubAdmin) {
    return NextResponse.json(
      { error: "Only a hub admin can change tool access" },
      { status: 403 }
    );
  }

  let body: { userId?: string; grant?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.userId || typeof body.grant !== "boolean") {
    return NextResponse.json(
      { error: "userId and grant are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Only ever grant to someone this tool would actually let in. Granting a
  // grower-side account would create a row that the page then refuses,
  // which reads as a broken grant rather than a refused one.
  const grantable = await listGrantableUsers(TOOL_KEY);
  const target = grantable.find((u) => u.id === body.userId);
  if (!target) {
    return NextResponse.json(
      {
        error:
          "That user is not a Mackays internal account, so they cannot be given " +
          "a tool. Give them Grower Portal admin or staff access first.",
      },
      { status: 400 }
    );
  }
  if (target.alwaysAllowed && !body.grant) {
    return NextResponse.json(
      { error: "Hub admins always have access to every tool and cannot be revoked here." },
      { status: 400 }
    );
  }

  if (body.grant) {
    const { error } = await admin.from("tool_access").upsert(
      {
        tool_key: TOOL_KEY,
        user_id: body.userId,
        granted_by: access.session.hubUser.id,
      },
      { onConflict: "tool_key,user_id" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await admin
      .from("tool_access")
      .delete()
      .eq("tool_key", TOOL_KEY)
      .eq("user_id", body.userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users: await listGrantableUsers(TOOL_KEY) });
}
