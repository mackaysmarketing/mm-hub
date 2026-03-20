import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function getCapabilities(session: NonNullable<Awaited<ReturnType<typeof getUserSession>>>): string[] {
  const access = session.moduleAccess.find((m) => m.module_id === "grower-portal");
  if (!access) return [];
  return (access.config as Record<string, unknown>).capabilities as string[] ?? [];
}

export async function GET() {
  const session = await getUserSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const caps = getCapabilities(session);
  const isHubAdmin = session.hubUser.hub_role === "hub_admin";
  if (!isHubAdmin && !caps.includes("enter_qa") && !caps.includes("view_all_growers")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Fetch all active growers
  const { data: growers, error: growersError } = await admin
    .from("growers")
    .select("id, name, code")
    .eq("active", true)
    .order("name");

  if (growersError) {
    return NextResponse.json({ error: growersError.message }, { status: 500 });
  }

  if (!growers || growers.length === 0) {
    return NextResponse.json([]);
  }

  const growerIds = growers.map((g) => g.id);

  // Fetch latest QA assessment per grower + next upcoming audit per grower
  const [assessmentsResult, auditsResult] = await Promise.all([
    admin
      .from("qa_assessments")
      .select("grower_id, overall_score, status, assessment_date")
      .in("grower_id", growerIds)
      .order("assessment_date", { ascending: false }),
    admin
      .from("qa_audits")
      .select("grower_id, scheduled_date")
      .in("grower_id", growerIds)
      .is("completed_date", null)
      .order("scheduled_date", { ascending: true }),
  ]);

  // Get latest assessment per grower (first occurrence since sorted desc)
  const latestAssessment = new Map<string, { overall_score: number; status: string; assessment_date: string }>();
  for (const row of assessmentsResult.data ?? []) {
    if (!latestAssessment.has(row.grower_id)) {
      latestAssessment.set(row.grower_id, row);
    }
  }

  // Get next audit per grower (first occurrence since sorted asc)
  const nextAudit = new Map<string, string>();
  for (const row of auditsResult.data ?? []) {
    if (!nextAudit.has(row.grower_id) && row.scheduled_date) {
      nextAudit.set(row.grower_id, row.scheduled_date);
    }
  }

  const result = growers.map((g) => {
    const assessment = latestAssessment.get(g.id);
    return {
      grower_id: g.id,
      grower_name: g.name,
      grower_code: g.code,
      latest_score: assessment?.overall_score ?? null,
      latest_status: assessment?.status ?? null,
      last_assessed: assessment?.assessment_date ?? null,
      next_audit_date: nextAudit.get(g.id) ?? null,
    };
  });

  return NextResponse.json(result);
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
  const {
    grower_id,
    assessment_date,
    overall_score,
    status,
    notes,
    categories,
  } = body as {
    grower_id: string;
    assessment_date: string;
    overall_score: number;
    status?: string;
    notes?: string;
    categories: {
      category: string;
      score: number;
      max_score: number;
      status?: string;
      findings?: string;
      action_required?: string;
      due_date?: string;
    }[];
  };

  if (!grower_id || !assessment_date || categories.length === 0) {
    return NextResponse.json(
      { error: "Missing required fields: grower_id, assessment_date, categories" },
      { status: 400 }
    );
  }

  // Auto-calculate status from overall_score if not provided
  const derivedStatus =
    status ||
    (overall_score >= 80
      ? "compliant"
      : overall_score >= 60
        ? "at_risk"
        : "non_compliant");

  const admin = createAdminClient();

  // Insert assessment
  const { data: assessment, error: assessmentError } = await admin
    .from("qa_assessments")
    .insert({
      grower_id,
      assessment_date,
      overall_score,
      status: derivedStatus,
      notes: notes || null,
      assessed_by: session.hubUser.id,
    })
    .select()
    .single();

  if (assessmentError) {
    return NextResponse.json(
      { error: assessmentError.message },
      { status: 500 }
    );
  }

  // Insert category scores
  const categoryRows = categories.map((cat) => ({
    assessment_id: assessment.id,
    category: cat.category,
    score: cat.score,
    max_score: cat.max_score,
    status:
      cat.status ||
      (cat.score / cat.max_score >= 0.8
        ? "pass"
        : cat.score / cat.max_score >= 0.6
          ? "warning"
          : "fail"),
    findings: cat.findings || null,
    action_required: cat.action_required || null,
    due_date: cat.due_date || null,
  }));

  const { error: catError } = await admin
    .from("qa_category_scores")
    .insert(categoryRows);

  if (catError) {
    return NextResponse.json({ error: catError.message }, { status: 500 });
  }

  return NextResponse.json(assessment);
}
