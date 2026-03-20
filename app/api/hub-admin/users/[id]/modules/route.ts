import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getDefaultMenuItemsForRole,
  getDefaultCapabilitiesForRole,
} from "@/lib/modules";
import type { ModuleId } from "@/types/modules";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { module_id, module_role, config } = body as {
    module_id: ModuleId;
    module_role: string;
    config?: Record<string, unknown>;
  };

  if (!module_id || !module_role) {
    return NextResponse.json(
      { error: "Missing required fields: module_id, module_role" },
      { status: 400 }
    );
  }

  // Build config with defaults if not provided
  const defaultMenuItems = getDefaultMenuItemsForRole(module_id, module_role);
  const defaultCapabilities = getDefaultCapabilitiesForRole(
    module_id,
    module_role
  );

  const finalConfig = {
    allowed_menu_items: defaultMenuItems,
    capabilities: defaultCapabilities,
    ...config,
  };

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("module_access")
    .upsert(
      {
        user_id: params.id,
        module_id,
        module_role,
        config: finalConfig,
        active: true,
        granted_by: session.hubUser.id,
      },
      { onConflict: "user_id,module_id" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
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
  const { module_id, module_role, config, active } = body as {
    module_id: string;
    module_role?: string;
    config?: Record<string, unknown>;
    active?: boolean;
  };

  if (!module_id) {
    return NextResponse.json(
      { error: "Missing required field: module_id" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const updates: Record<string, unknown> = {};
  if (module_role !== undefined) updates.module_role = module_role;
  if (config !== undefined) updates.config = config;
  if (active !== undefined) updates.active = active;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("module_access")
    .update(updates)
    .eq("user_id", params.id)
    .eq("module_id", module_id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const moduleId = searchParams.get("module_id");

  if (!moduleId) {
    return NextResponse.json(
      { error: "Missing required param: module_id" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { error } = await admin
    .from("module_access")
    .delete()
    .eq("user_id", params.id)
    .eq("module_id", moduleId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
