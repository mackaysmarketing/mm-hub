"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { RemittanceDetail } from "@/components/remittance-detail";

export default function RemittanceDetailPage() {
  const params = useParams<{ id: string }>();

  return (
    <div className="space-y-4">
      <Link
        href="/remittances"
        className="inline-flex items-center gap-1.5 text-sm text-stone transition-colors hover:text-soil"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to remittances
      </Link>

      <div className="rounded-xl border border-sand bg-warmwhite">
        <RemittanceDetail remittanceId={params.id} />
      </div>
    </div>
  );
}
