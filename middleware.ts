import { updateSession } from "@/lib/supabase/middleware";
import { getPortalMode } from "@/lib/subdomain";
import { type NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  // TEMPORARY: bypass updateSession to test if middleware is clearing cookies
  // const response = await updateSession(request);
  const response = NextResponse.next({ request });

  // Detect portal mode from hostname
  const hostname = request.headers.get("host") || "localhost";
  const mode = getPortalMode(hostname);

  // Set portal mode header so pages/layouts can read it
  response.headers.set("x-portal-mode", mode);

  const { pathname } = request.nextUrl;

  // Grower mode: block hub-admin routes
  if (mode === "grower" && pathname.startsWith("/hub-admin")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder assets
     * - API routes
     * - /callback (auth code exchange — must set its own cookies without
     *   middleware calling getUser() and potentially clearing them)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$|api/|callback).*)",
  ],
};
