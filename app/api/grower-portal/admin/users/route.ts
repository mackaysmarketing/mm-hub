import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET — List users for the grower admin's grower
 * POST — Create a new grower user
 * PATCH — Update a grower user's access
 * DELETE — Deactivate a grower user
 */

async function getGrowerAdminContext() {
  const session = await getUserSession();
  if (!session) return null;

  const portalAccess = session.moduleAccess.find(
    (m) => m.module_id === "grower-portal" && m.active
  );
  if (!portalAccess) return null;

  const config = portalAccess.config as Record<string, unknown>;
  const capabilities = (config.capabilities as string[]) ?? [];

  // Must have manage_grower_users capability
  if (!capabilities.includes("manage_grower_users")) return null;

  const growerId = config.grower_id as string;
  if (!growerId) return null;

  return { session, growerId, portalAccess };
}

export async function GET() {
  const ctx = await getGrowerAdminContext();
  if (!ctx) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Get all module_access rows for grower-portal with this grower_id
  const { data: accessRows, error: accessError } = await admin
    .from("module_access")
    .select("user_id, module_role, config, active, created_at, updated_at")
    .eq("module_id", "grower-portal")
    .filter("config->>grower_id", "eq", ctx.growerId);

  if (accessError) {
    return NextResponse.json({ error: accessError.message }, { status: 500 });
  }

  if (!accessRows || accessRows.length === 0) {
    return NextResponse.json([]);
  }

  // Get user details for all user_ids
  const userIds = accessRows.map((r) => r.user_id);
  const { data: users } = await admin
    .from("hub_users")
    .select("id, name, email, auth_provider, active")
    .in("id", userIds);

  const userMap = new Map((users ?? []).map((u) => [u.id, u]));

  const result = accessRows
    .filter((r) => {
      // Don't show the grower_admin's own record or admin/staff roles
      const role = r.module_role;
      return role === "grower" || role === "grower_admin";
    })
    .map((r) => {
      const user = userMap.get(r.user_id);
      const config = r.config as Record<string, unknown>;
      return {
        user_id: r.user_id,
        name: user?.name ?? "Unknown",
        email: user?.email ?? "",
        auth_provider: user?.auth_provider ?? "email",
        module_role: r.module_role,
        farm_ids: (config.farm_ids as string[] | null) ?? null,
        allowed_menu_items: (config.allowed_menu_items as string[]) ?? [],
        financial_access:
          (config.financial_access as Record<string, boolean>) ?? {},
        capabilities: (config.capabilities as string[]) ?? [],
        active: r.active,
        user_active: user?.active ?? false,
        created_at: r.created_at,
      };
    });

  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const ctx = await getGrowerAdminContext();
  if (!ctx) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const {
    name,
    email,
    password,
    farm_ids,
    allowed_menu_items,
    financial_access,
  } = body as {
    name: string;
    email: string;
    password: string;
    farm_ids: string[] | null;
    allowed_menu_items: string[];
    financial_access: Record<string, boolean>;
  };

  if (!name || !email || !password) {
    return NextResponse.json(
      { error: "Name, email, and password are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Validate farm_ids belong to this grower
  if (farm_ids && farm_ids.length > 0) {
    const { data: farms } = await admin
      .from("farms")
      .select("id")
      .eq("grower_id", ctx.growerId)
      .in("id", farm_ids);

    if (!farms || farms.length !== farm_ids.length) {
      return NextResponse.json(
        { error: "Invalid farm IDs — farms must belong to your grower" },
        { status: 400 }
      );
    }
  }

  // Create Supabase Auth user
  const { data: authUser, error: authError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name },
    });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  // The auth trigger will create the hub_users record.
  // Now create module_access for grower-portal
  const { data: accessRow, error: accessError } = await admin
    .from("module_access")
    .insert({
      user_id: authUser.user.id,
      module_id: "grower-portal",
      module_role: "grower",
      config: {
        grower_id: ctx.growerId,
        farm_ids: farm_ids,
        allowed_menu_items: allowed_menu_items,
        financial_access: financial_access,
        capabilities: [],
      },
      active: true,
      granted_by: ctx.session.hubUser.id,
    })
    .select()
    .single();

  if (accessError) {
    return NextResponse.json({ error: accessError.message }, { status: 500 });
  }

  return NextResponse.json(accessRow, { status: 201 });
}

export async function PATCH(request: Request) {
  const ctx = await getGrowerAdminContext();
  if (!ctx) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const {
    user_id,
    farm_ids,
    allowed_menu_items,
    financial_access,
    active,
  } = body as {
    user_id: string;
    farm_ids?: string[] | null;
    allowed_menu_items?: string[];
    financial_access?: Record<string, boolean>;
    active?: boolean;
  };

  if (!user_id) {
    return NextResponse.json(
      { error: "user_id is required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Verify the target user belongs to the same grower
  const { data: existingAccess } = await admin
    .from("module_access")
    .select("config")
    .eq("user_id", user_id)
    .eq("module_id", "grower-portal")
    .single();

  if (!existingAccess) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const existingConfig = existingAccess.config as Record<string, unknown>;
  if (existingConfig.grower_id !== ctx.growerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Validate farm_ids
  if (farm_ids && farm_ids.length > 0) {
    const { data: farms } = await admin
      .from("farms")
      .select("id")
      .eq("grower_id", ctx.growerId)
      .in("id", farm_ids);

    if (!farms || farms.length !== farm_ids.length) {
      return NextResponse.json(
        { error: "Invalid farm IDs" },
        { status: 400 }
      );
    }
  }

  // Build updated config
  const updatedConfig = { ...existingConfig };
  if (farm_ids !== undefined) updatedConfig.farm_ids = farm_ids;
  if (allowed_menu_items !== undefined)
    updatedConfig.allowed_menu_items = allowed_menu_items;
  if (financial_access !== undefined)
    updatedConfig.financial_access = financial_access;

  const updates: Record<string, unknown> = { config: updatedConfig };
  if (active !== undefined) updates.active = active;

  const { data, error } = await admin
    .from("module_access")
    .update(updates)
    .eq("user_id", user_id)
    .eq("module_id", "grower-portal")
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const ctx = await getGrowerAdminContext();
  if (!ctx) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id");

  if (!userId) {
    return NextResponse.json(
      { error: "user_id is required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Verify the target user belongs to the same grower
  const { data: existingAccess } = await admin
    .from("module_access")
    .select("config")
    .eq("user_id", userId)
    .eq("module_id", "grower-portal")
    .single();

  if (!existingAccess) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const config = existingAccess.config as Record<string, unknown>;
  if (config.grower_id !== ctx.growerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Deactivate (don't delete)
  const { error } = await admin
    .from("module_access")
    .update({ active: false })
    .eq("user_id", userId)
    .eq("module_id", "grower-portal");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
