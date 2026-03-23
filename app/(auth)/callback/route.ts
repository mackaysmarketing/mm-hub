import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPortalMode } from "@/lib/subdomain";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const hostname = request.headers.get("host") || "localhost";
  const mode = getPortalMode(hostname);
  const destination = mode === "grower" ? "/dashboard" : "/";

  console.log("[callback] hit", {
    hasCode: !!code,
    hostname,
    mode,
    destination,
    origin,
    forwardedHost: request.headers.get("x-forwarded-host"),
  });

  if (code) {
    const cookieStore = cookies();

    // Track all cookies in a local map so getAll() sees what setAll() wrote.
    const cookieMap = new Map<
      string,
      { name: string; value: string; options?: Record<string, unknown> }
    >();
    cookieStore
      .getAll()
      .forEach((c) => cookieMap.set(c.name, { name: c.name, value: c.value }));

    console.log("[callback] incoming cookies:", Array.from(cookieMap.keys()));

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            const result = Array.from(cookieMap.values()).map(
              ({ name, value }) => ({ name, value })
            );
            console.log("[callback] getAll called, returning", result.length, "cookies:", result.map(c => c.name));
            return result;
          },
          setAll(cookiesToSet) {
            console.log("[callback] setAll called with", cookiesToSet.length, "cookies:", cookiesToSet.map(c => c.name));
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieMap.set(name, { name, value, options });
            });
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    console.log("[callback] exchangeCodeForSession result:", {
      success: !error,
      error: error?.message,
    });

    if (!error) {
      const forwardedHost = request.headers.get("x-forwarded-host");
      const redirectBase = forwardedHost
        ? `https://${forwardedHost}`
        : origin;

      const response = NextResponse.redirect(
        new URL(destination, redirectBase)
      );

      // Apply every cookie (including the new session tokens) to the response.
      const cookieNames: string[] = [];
      cookieMap.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, (options as Record<string, unknown>) ?? {});
        cookieNames.push(name);
      });

      console.log("[callback] redirecting to", destination, "with cookies:", cookieNames);
      console.log("[callback] redirect URL:", new URL(destination, redirectBase).toString());

      return response;
    }

    console.log("[callback] exchange FAILED, redirecting to /login?error=auth");
  }

  return NextResponse.redirect(new URL("/login?error=auth", origin));
}
