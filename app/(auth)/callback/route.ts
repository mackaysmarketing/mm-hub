import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPortalMode } from "@/lib/subdomain";

// In-memory diagnostic log for the last callback attempt
let lastCallbackDiag: Record<string, unknown> | null = null;

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  // Diagnostic readout: GET /callback?diag=1
  if (searchParams.get("diag") === "1") {
    return NextResponse.json(lastCallbackDiag ?? { message: "No callback attempt yet" });
  }

  const code = searchParams.get("code");
  const hostname = request.headers.get("host") || "localhost";
  const mode = getPortalMode(hostname);
  const destination = mode === "grower" ? "/dashboard" : "/";

  const diag: Record<string, unknown> = { timestamp: new Date().toISOString() };

  if (code) {
    const cookieStore = cookies();
    const incomingCookies = cookieStore.getAll();
    diag.incomingCookies = incomingCookies.map((c) => c.name);

    const pendingCookies: Array<{
      name: string;
      value: string;
      options: Record<string, unknown>;
    }> = [];
    const setErrors: Array<{ name: string; error: string }> = [];

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
              } catch (e: unknown) {
                setErrors.push({
                  name,
                  error: e instanceof Error ? e.message : String(e),
                });
              }
            });
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    diag.exchangeError = error?.message ?? null;
    diag.pendingCookies = pendingCookies.map((c) => ({
      name: c.name,
      valueLength: c.value.length,
      options: c.options,
    }));
    diag.cookieStoreSetErrors = setErrors;

    if (!error) {
      const forwardedHost = request.headers.get("x-forwarded-host");
      const redirectBase = forwardedHost
        ? `https://${forwardedHost}`
        : origin;

      const redirectUrl = new URL(destination, redirectBase).toString();
      diag.redirectUrl = redirectUrl;

      const response = NextResponse.redirect(redirectUrl);

      for (const { name, value, options } of pendingCookies) {
        response.cookies.set(name, value, options);
      }

      const setCookieHeaders = response.headers.getSetCookie();
      diag.setCookieHeaderCount = setCookieHeaders.length;
      diag.setCookieHeaders = setCookieHeaders.map((h) => ({
        preview: h.substring(0, 100) + "...",
        totalLength: h.length,
      }));

      lastCallbackDiag = diag;
      return response;
    }

    lastCallbackDiag = diag;
  }

  return NextResponse.redirect(new URL("/login?error=auth", origin));
}
