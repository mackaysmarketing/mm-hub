import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const growerId = searchParams.get("growerId");

  const supabase = createClient();

  // Fetch latest assessment, category scores, and upcoming audits in parallel
  const assessmentQuery = supabase
    .from("qa_assessments")
    .select("id, assessment_date, overall_score, status, notes, assessed_by")
    .order("assessment_date", { ascending: false })
    .limit(1);

  if (growerId) assessmentQuery.eq("grower_id", growerId);

  const auditsQuery = supabase
    .from("qa_audits")
    .select(
      "id, audit_type, scheduled_date, completed_date, auditor, result, certificate_expiry, notes"
    )
    .is("completed_date", null)
    .order("scheduled_date", { ascending: true })
    .limit(5);

  if (growerId) auditsQuery.eq("grower_id", growerId);

  const [assessmentResult, auditsResult] = await Promise.all([
    assessmentQuery,
    auditsQuery,
  ]);

  if (assessmentResult.error) {
    return NextResponse.json(
      { error: assessmentResult.error.message },
      { status: 500 }
    );
  }

  const latestAssessment = assessmentResult.data?.[0] ?? null;

  // Fetch category scores for the latest assessment
  let categoryScores: {
    id: string;
    category: string;
    score: number;
    max_score: number;
    status: string;
    findings: string | null;
    action_required: string | null;
    due_date: string | null;
  }[] = [];

  if (latestAssessment) {
    const { data: scores, error: scoresError } = await supabase
      .from("qa_category_scores")
      .select(
        "id, category, score, max_score, status, findings, action_required, due_date"
      )
      .eq("assessment_id", latestAssessment.id);

    if (scoresError) {
      return NextResponse.json(
        { error: scoresError.message },
        { status: 500 }
      );
    }

    categoryScores = scores ?? [];
  }

  // Build action items from category scores that have action_required
  const actionItems = categoryScores
    .filter((s) => s.action_required)
    .map((s) => ({
      id: s.id,
      category: s.category,
      action: s.action_required,
      status: s.status,
      dueDate: s.due_date,
    }));

  return NextResponse.json({
    assessment: latestAssessment,
    categoryScores,
    actionItems,
    upcomingAudits: auditsResult.data ?? [],
  });
}
