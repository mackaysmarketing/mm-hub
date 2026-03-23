import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET() {
  // Approach A: direct createServerClient (this WORKED before)
  const cookieStore = cookies();
  const rawCookies = cookieStore.getAll();

  const directClient = createServerClient(
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
            // ignore
          }
        },
      },
    }
  );

  const directResult = await directClient.auth.getUser();

  // Approach B: createClient() from lib/supabase/server.ts
  const libClient = createClient();
  const libResult = await libClient.auth.getUser();

  return NextResponse.json({
    rawCookieNames: rawCookies.map((c) => c.name),
    rawCookieCount: rawCookies.length,
    directClient: {
      user: directResult.data.user
        ? { id: directResult.data.user.id, email: directResult.data.user.email }
        : null,
      error: directResult.error?.message || null,
    },
    libClient: {
      user: libResult.data.user
        ? { id: libResult.data.user.id, email: libResult.data.user.email }
        : null,
      error: libResult.error?.message || null,
    },
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
}
