import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  DEMO_ACCESS_COOKIE,
  getPublicRequestUrl,
  hasValidDemoSession,
} from "@/lib/demo-access";
import {
  createDemoSessionId,
  DEMO_SESSION_COOKIE,
  DEMO_SESSION_COOKIE_OPTIONS,
  isValidDemoSessionId,
} from "@/lib/demo-session";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isAccessRoute =
    pathname === "/access" || pathname === "/api/access";
  const authorized = await hasValidDemoSession(
    request.cookies.get(DEMO_ACCESS_COOKIE)?.value,
  );

  if (isAccessRoute) {
    if (authorized && pathname === "/access") {
      const response = NextResponse.redirect(getPublicRequestUrl(request, "/"));
      ensureSessionCookie(request, response);
      return response;
    }
    return NextResponse.next();
  }

  if (authorized) {
    const response = NextResponse.next();
    ensureSessionCookie(request, response);
    return response;
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Demo access key required." },
      { status: 401 },
    );
  }

  return NextResponse.redirect(getPublicRequestUrl(request, "/access"));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

function ensureSessionCookie(request: NextRequest, response: NextResponse) {
  if (
    !isValidDemoSessionId(
      request.cookies.get(DEMO_SESSION_COOKIE)?.value,
    )
  ) {
    response.cookies.set({
      name: DEMO_SESSION_COOKIE,
      value: createDemoSessionId(),
      ...DEMO_SESSION_COOKIE_OPTIONS,
    });
  }
}
