import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  // Step 1: Basic auth check
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({
      step: "auth.getUser",
      success: false,
      error: authError?.message || "No user",
    });
  }

  // Step 2: hub_users lookup (same query as getUserSession)
  const { data: hubUser, error: hubError } = await supabase
    .from("hub_users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!hubUser) {
    return NextResponse.json({
      step: "hub_users_lookup",
      success: false,
      userId: user.id,
      email: user.email,
      error: hubError?.message || "No row found",
      hint: "User exists in Supabase Auth but NOT in hub_users table",
    });
  }

  if (!hubUser.active) {
    return NextResponse.json({
      step: "hub_users_active_check",
      success: false,
      userId: user.id,
      hubUserId: hubUser.id,
      active: hubUser.active,
      hint: "hub_users row exists but active=false",
    });
  }

  // Step 3: module_access lookup
  const { data: moduleRows, error: modError } = await supabase
    .from("module_access")
    .select("*")
    .eq("user_id", user.id)
    .eq("active", true);

  // Step 4: Full getUserSession() call
  const session = await getUserSession();

  return NextResponse.json({
    step: "full_check",
    success: !!session,
    user: { id: user.id, email: user.email },
    hubUser: { id: hubUser.id, name: hubUser.name, active: hubUser.active, hub_role: hubUser.hub_role },
    moduleAccess: (moduleRows || []).map((r: Record<string, unknown>) => ({ module_id: r.module_id, active: r.active })),
    moduleError: modError?.message || null,
    getUserSessionReturnsNull: session === null,
  });
}
