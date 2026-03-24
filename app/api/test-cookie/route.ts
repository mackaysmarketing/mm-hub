import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  if (action === "set") {
    // Try setting a cookie via cookieStore, then redirect to read it
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
        message: "Cookie set via cookieStore.set(). Now visit /api/test-cookie?action=read",
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
    // Set cookie then redirect (mimics callback flow)
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
    // Set cookie on a NextResponse.redirect (the old approach)
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

  // Default: read all cookies
  const cookieStore = cookies();
  const allCookies = cookieStore.getAll();
  return NextResponse.json({
    step: "read",
    cookieCount: allCookies.length,
    cookies: allCookies.map((c) => ({ name: c.name, valueLength: c.value.length })),
  });
}
