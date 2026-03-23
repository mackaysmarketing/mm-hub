import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();

  // Step 1: Get the Supabase auth user
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({
      step: "auth.getUser",
      success: false,
      error: authError?.message || "No user found",
    });
  }

  // Step 2: Look up hub_users row
  const { data: hubUser, error: hubError } = await supabase
    .from("hub_users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (hubError || !hubUser) {
    return NextResponse.json({
      step: "hub_users lookup",
      success: false,
      userId: user.id,
      email: user.email,
      error: hubError?.message || "No hub_users row found",
      hubUser: null,
    });
  }

  if (!hubUser.active) {
    return NextResponse.json({
      step: "hub_users.active check",
      success: false,
      userId: user.id,
      email: user.email,
      hubUser: { id: hubUser.id, name: hubUser.name, active: hubUser.active, hub_role: hubUser.hub_role },
    });
  }

  // Step 3: Look up module_access
  const { data: moduleRows, error: moduleError } = await supabase
    .from("module_access")
    .select("*")
    .eq("user_id", user.id)
    .eq("active", true);

  return NextResponse.json({
    step: "complete",
    success: true,
    userId: user.id,
    email: user.email,
    hubUser: {
      id: hubUser.id,
      name: hubUser.name,
      email: hubUser.email,
      hub_role: hubUser.hub_role,
      active: hubUser.active,
    },
    moduleAccess: (moduleRows || []).map((r: Record<string, unknown>) => ({
      module_id: r.module_id,
      module_role: r.module_role,
      active: r.active,
    })),
    moduleError: moduleError?.message || null,
  });
}
