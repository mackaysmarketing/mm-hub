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
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              pendingCookies.push({
                name,
                value,
                options: options as Record<string, unknown>,
              });
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

      // Return a 200 HTML page so we can inspect cookies in the browser
      // before any redirect/middleware runs
      const response = new NextResponse(
        `<!DOCTYPE html>
<html><head></head><body>
<h2>Auth callback succeeded</h2>
<p>Cookies being set: ${pendingCookies.length} auth + 1 canary</p>
<p>Check DevTools Application > Cookies, then click below:</p>
<a href="${new URL(destination, redirectBase).toString()}">Continue to app</a>
<hr>
<pre id="cookies"></pre>
<script>document.getElementById("cookies").textContent = document.cookie || "(no cookies visible to JS)";</script>
</body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );

      // Set a canary cookie to test if ANY cookie from this path survives
      response.cookies.set("callback-canary", "alive", {
        path: "/",
        sameSite: "lax",
        httpOnly: false,
        maxAge: 3600,
      });

      // Set all the auth cookies
      for (const { name, value, options } of pendingCookies) {
        response.cookies.set(name, value, options);
      }

      return response;
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth", origin));
}
