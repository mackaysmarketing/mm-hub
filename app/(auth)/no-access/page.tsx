"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export default function NoAccessPage() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="w-full rounded-xl border border-sand bg-warmwhite p-10 shadow-sm text-center">
      <h1 className="font-display text-xl text-forest mb-4">No Access</h1>
      <p className="text-stone text-sm mb-6">
        Your account has been created but you haven&apos;t been assigned to any
        modules yet. Please contact your administrator.
      </p>
      <Button
        onClick={handleSignOut}
        variant="outline"
        className="border-sand text-bark hover:bg-sand/50"
      >
        Sign out
      </Button>
    </div>
  );
}
