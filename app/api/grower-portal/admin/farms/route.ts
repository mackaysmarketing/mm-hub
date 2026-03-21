import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET — List farms for the current user's grower (or all farms for admin/staff).
 *       Used by farm selector and grower admin user management form.
 *
 * POST — Create a farm manually (hub admin only).
 *        For cases where farms aren't yet synced from FreshTrack.
 */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const growerId = searchParams.get("growerId");

  const supabase = createClient();

  let query = supabase
    .from("farms")
    .select("*")
    .eq("active", true)
    .order("name");

  if (growerId) {
    query = query.eq("grower_id", growerId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session || session.hubUser.hub_role !== "hub_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { grower_id, name, code, region, location } = body as {
    grower_id: string;
    name: string;
    code?: string;
    region?: string;
    location?: string;
  };

  if (!grower_id || !name) {
    return NextResponse.json(
      { error: "grower_id and name are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("farms")
    .insert({
      grower_id,
      name,
      code: code || null,
      region: region || null,
      location: location || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
