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

  if (code) {
    const cookieStore = cookies();

    // Track all cookies in a local map so getAll() sees what setAll() wrote.
    // This is critical: @supabase/ssr may call getAll() after setAll() during
    // the PKCE exchange, and the immutable cookieStore won't reflect new values.
    const cookieMap = new Map<
      string,
      { name: string; value: string; options?: Record<string, unknown> }
    >();
    cookieStore
      .getAll()
      .forEach((c) => cookieMap.set(c.name, { name: c.name, value: c.value }));

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return Array.from(cookieMap.values()).map(({ name, value }) => ({
              name,
              value,
            }));
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieMap.set(name, { name, value, options });
            });
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Use x-forwarded-host so the redirect targets the real domain on Vercel,
      // not the internal deployment URL.
      const forwardedHost = request.headers.get("x-forwarded-host");
      const redirectBase = forwardedHost
        ? `https://${forwardedHost}`
        : origin;

      const response = NextResponse.redirect(
        new URL(destination, redirectBase)
      );

      // Apply every cookie (including the new session tokens) to the response.
      cookieMap.forEach(({ name, value, options }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase SSR cookie options are untyped
        response.cookies.set(name, value, (options as Record<string, unknown>) ?? {});
      });

      return response;
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth", origin));
}
