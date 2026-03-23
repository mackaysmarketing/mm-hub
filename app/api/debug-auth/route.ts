import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cookieStore = cookies();
  const allCookies = cookieStore.getAll();

  // Check which Supabase auth cookies exist
  const authCookies = allCookies
    .filter((c) => c.name.includes("auth") || c.name.includes("sb-"))
    .map((c) => ({
      name: c.name,
      valueLength: c.value.length,
      valuePreview: c.value.substring(0, 30) + "...",
    }));

  // Try to get the user
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // ignore in read-only context
          }
        },
      },
    }
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    host: request.headers.get("host"),
    xForwardedHost: request.headers.get("x-forwarded-host"),
    origin: new URL(request.url).origin,
    totalCookies: allCookies.length,
    authCookies,
    user: user
      ? { id: user.id, email: user.email, provider: user.app_metadata?.provider }
      : null,
    error: error?.message || null,
  });
}
