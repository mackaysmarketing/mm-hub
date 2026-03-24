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

    // Collect cookies that need to be set on the response.
    // cookieStore.set() may throw for large auth tokens; @supabase/ssr
    // swallows the error, so we must also set them on the response object.
    const pendingCookies: Array<{
      name: string;
      value: string;
      options: Record<string, unknown>;
    }> = [];

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              pendingCookies.push({
                name,
                value,
                options: options as Record<string, unknown>,
              });
              try {
                cookieStore.set(name, value, options);
              } catch {
                // Will be set on the redirect response below as fallback
              }
            });
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const forwardedHost = request.headers.get("x-forwarded-host");
      const redirectBase = forwardedHost
        ? `https://${forwardedHost}`
        : origin;

      const response = NextResponse.redirect(
        new URL(destination, redirectBase)
      );

      // Apply every pending cookie to the redirect response as well.
      for (const { name, value, options } of pendingCookies) {
        response.cookies.set(name, value, options);
      }

      return response;
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth", origin));
}
