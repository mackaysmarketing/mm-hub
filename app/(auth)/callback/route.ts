import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPortalMode } from "@/lib/subdomain";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Redirect based on subdomain mode
      const hostname = request.headers.get("host") || "localhost";
      const mode = getPortalMode(hostname);

      if (mode === "grower") {
        return NextResponse.redirect(new URL("/dashboard", origin));
      }
      // Hub and dev: go through root routing logic
      return NextResponse.redirect(new URL("/", origin));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth", request.url));
}
