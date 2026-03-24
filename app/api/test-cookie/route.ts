import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  if (action === "set") {
    const cookieStore = cookies();
    try {
      cookieStore.set("test-auth-cookie", "it-works", {
        path: "/",
        maxAge: 3600,
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      });
      return NextResponse.json({
        step: "set",
        success: true,
        message:
          "Cookie set via cookieStore.set(). Now visit /api/test-cookie?action=read",
      });
    } catch (e: unknown) {
      return NextResponse.json({
        step: "set",
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (action === "set-redirect") {
    const cookieStore = cookies();
    try {
      cookieStore.set("test-redirect-cookie", "redirect-works", {
        path: "/",
        maxAge: 3600,
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      });
    } catch (e: unknown) {
      return NextResponse.json({
        step: "set-redirect",
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    redirect("/api/test-cookie?action=read");
  }

  if (action === "set-response") {
    const response = NextResponse.redirect(
      new URL("/api/test-cookie?action=read", request.url)
    );
    response.cookies.set("test-response-cookie", "response-works", {
      path: "/",
      maxAge: 3600,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });
    return response;
  }

  // Simulate the exact auth callback: 4 large cookies on a 200 HTML response
  if (action === "set-large") {
    const bigValue = "x".repeat(3200);
    const response = new NextResponse(
      `<!DOCTYPE html><html><head>
<meta http-equiv="refresh" content="0;url=/api/test-cookie?action=read">
</head><body>Redirecting...</body></html>`,
      { status: 200, headers: { "Content-Type": "text/html" } }
    );

    // Mimic exact Supabase SSR options from the diagnostic
    const opts = { path: "/", sameSite: "lax" as const, httpOnly: false, maxAge: 34560000 };
    response.cookies.set("test-big-0", bigValue, opts);
    response.cookies.set("test-big-1", bigValue, opts);
    response.cookies.set("test-big-2", bigValue.substring(0, 1100), opts);

    return response;
  }

  // Default: read all cookies
  const cookieStore = cookies();
  const allCookies = cookieStore.getAll();
  return NextResponse.json({
    step: "read",
    cookieCount: allCookies.length,
    cookies: allCookies.map((c) => ({
      name: c.name,
      valueLength: c.value.length,
    })),
  });
}
