import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search");

  const admin = createAdminClient();

  let query = admin
    .from("hub_users")
    .select("*")
    .order("created_at", { ascending: false });

  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    query = query.or(`name.ilike.${term},email.ilike.${term}`);
  }

  const { data: users, error: usersError } = await query;

  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 });
  }

  // Fetch all module_access records for these users
  const userIds = (users ?? []).map((u) => u.id);
  const { data: moduleRows, error: modError } = await admin
    .from("module_access")
    .select("id, user_id, module_id, module_role, config, active")
    .in("user_id", userIds.length > 0 ? userIds : ["__none__"]);

  if (modError) {
    return NextResponse.json({ error: modError.message }, { status: 500 });
  }

  // Group modules by user
  const modulesByUser = new Map<string, typeof moduleRows>();
  for (const row of moduleRows ?? []) {
    const existing = modulesByUser.get(row.user_id) ?? [];
    existing.push(row);
    modulesByUser.set(row.user_id, existing);
  }

  const result = (users ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    auth_provider: u.auth_provider,
    hub_role: u.hub_role,
    active: u.active,
    last_login_at: u.last_login_at,
    created_at: u.created_at,
    modules: modulesByUser.get(u.id) ?? [],
  }));

  return NextResponse.json({ users: result });
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { name, email, password, hub_role } = body as {
    name: string;
    email: string;
    password: string;
    hub_role: "hub_admin" | "user";
  };

  if (!name || !email || !password) {
    return NextResponse.json(
      { error: "Missing required fields: name, email, password" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Create auth user — the DB trigger auto-creates hub_users row
  const { data: authData, error: authError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name },
    });

  if (authError) {
    return NextResponse.json(
      { error: `Auth error: ${authError.message}` },
      { status: 400 }
    );
  }

  // If hub_role is hub_admin, update the hub_users row (trigger defaults to 'user')
  if (hub_role === "hub_admin" && authData.user) {
    const { error: updateError } = await admin
      .from("hub_users")
      .update({ hub_role: "hub_admin" })
      .eq("id", authData.user.id);

    if (updateError) {
      return NextResponse.json(
        { error: `Failed to set hub_role: ${updateError.message}` },
        { status: 500 }
      );
    }
  }

  // Fetch the created hub_users row to return
  const { data: hubUser } = await admin
    .from("hub_users")
    .select("*")
    .eq("id", authData.user!.id)
    .single();

  return NextResponse.json(hubUser);
}
