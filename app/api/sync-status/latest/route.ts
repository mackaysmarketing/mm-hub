import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ lastSync: null });
  }

  const { data } = await supabase
    .from("sync_logs")
    .select("completed_at")
    .eq("status", "success")
    .eq("source", "freshtrack")
    .order("completed_at", { ascending: false })
    .limit(1)
    .single();

  return NextResponse.json({
    lastSync: data?.completed_at ?? null,
  });
}
