import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const [userResult, modulesResult] = await Promise.all([
    admin.from("hub_users").select("*").eq("id", params.id).single(),
    admin
      .from("module_access")
      .select("id, user_id, module_id, module_role, config, active, granted_by, created_at, updated_at")
      .eq("user_id", params.id),
  ]);

  if (userResult.error) {
    return NextResponse.json(
      { error: "User not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ...userResult.data,
    modules: modulesResult.data ?? [],
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { name, hub_role, active } = body as {
    name?: string;
    hub_role?: "hub_admin" | "user";
    active?: boolean;
  };

  const admin = createAdminClient();

  // Build update object
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (hub_role !== undefined) updates.hub_role = hub_role;
  if (active !== undefined) updates.active = active;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("hub_users")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If deactivating, also ban the auth user so they can't log in
  if (active === false) {
    await admin.auth.admin.updateUserById(params.id, {
      ban_duration: "876600h", // ~100 years
    });
  } else if (active === true) {
    // Re-enable auth user
    await admin.auth.admin.updateUserById(params.id, {
      ban_duration: "none",
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Soft delete: set active = false
  const { error } = await admin
    .from("hub_users")
    .update({ active: false })
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Ban auth user
  await admin.auth.admin.updateUserById(params.id, {
    ban_duration: "876600h",
  });

  return NextResponse.json({ success: true });
}
