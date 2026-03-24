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
            const all = cookieStore.getAll();
            console.log("[callback] getAll() returned:", all.map(c => c.name));
            return all;
          },
          setAll(cookiesToSet) {
            console.log("[callback] setAll() called with:", cookiesToSet.map(c => ({
              name: c.name,
              valueLen: c.value.length,
              options: c.options,
            })));
            cookiesToSet.forEach(({ name, value, options }) => {
              pendingCookies.push({ name, value, options: options as Record<string, unknown> });
              try {
                cookieStore.set(name, value, options);
                console.log(`[callback] cookieStore.set OK: ${name}`);
              } catch (e) {
                console.log(`[callback] cookieStore.set THREW for ${name}:`, e);
              }
            });
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    console.log("[callback] exchangeCodeForSession error:", error);
    console.log("[callback] pendingCookies count:", pendingCookies.length);

    if (!error) {
      const forwardedHost = request.headers.get("x-forwarded-host");
      const redirectBase = forwardedHost
        ? `https://${forwardedHost}`
        : origin;

      console.log("[callback] redirecting to:", new URL(destination, redirectBase).toString());

      const response = NextResponse.redirect(
        new URL(destination, redirectBase)
      );

      for (const { name, value, options } of pendingCookies) {
        response.cookies.set(name, value, options);
        console.log(`[callback] response.cookies.set: ${name} (${value.length} chars)`);
      }

      // Log the actual Set-Cookie headers on the response
      const setCookieHeaders = response.headers.getSetCookie();
      console.log("[callback] Set-Cookie headers count:", setCookieHeaders.length);
      setCookieHeaders.forEach((h, i) => {
        console.log(`[callback] Set-Cookie[${i}]:`, h.substring(0, 120) + "...");
      });

      return response;
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth", origin));
}
