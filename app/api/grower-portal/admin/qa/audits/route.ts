import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function getCapabilities(session: NonNullable<Awaited<ReturnType<typeof getUserSession>>>): string[] {
  const access = session.moduleAccess.find((m) => m.module_id === "grower-portal");
  if (!access) return [];
  return (access.config as Record<string, unknown>).capabilities as string[] ?? [];
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const caps = getCapabilities(session);
  const isHubAdmin = session.hubUser.hub_role === "hub_admin";
  if (!isHubAdmin && !caps.includes("enter_qa")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { grower_id, audit_type, scheduled_date, auditor, notes } = body as {
    grower_id: string;
    audit_type: string;
    scheduled_date: string;
    auditor?: string;
    notes?: string;
  };

  if (!grower_id || !audit_type || !scheduled_date) {
    return NextResponse.json(
      { error: "Missing required fields: grower_id, audit_type, scheduled_date" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("qa_audits")
    .insert({
      grower_id,
      audit_type,
      scheduled_date,
      auditor: auditor || null,
      notes: notes || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  const session = await getUserSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const caps = getCapabilities(session);
  const isHubAdmin = session.hubUser.hub_role === "hub_admin";
  if (!isHubAdmin && !caps.includes("enter_qa")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { id, completed_date, result, certificate_expiry, document_id, notes } =
    body as {
      id: string;
      completed_date?: string;
      result?: string;
      certificate_expiry?: string;
      document_id?: string;
      notes?: string;
    };

  if (!id) {
    return NextResponse.json({ error: "Missing required field: id" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (completed_date !== undefined) updates.completed_date = completed_date;
  if (result !== undefined) updates.result = result;
  if (certificate_expiry !== undefined) updates.certificate_expiry = certificate_expiry;
  if (document_id !== undefined) updates.document_id = document_id;
  if (notes !== undefined) updates.notes = notes;

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("qa_audits")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
