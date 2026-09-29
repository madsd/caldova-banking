import { NextResponse } from "next/server";
import {
  DEMO_ACCESS_COOKIE,
  getPublicRequestUrl,
  getDemoSessionToken,
  isValidDemoKey,
} from "@/lib/demo-access";
import {
  createDemoSessionId,
  DEMO_SESSION_COOKIE,
  DEMO_SESSION_COOKIE_OPTIONS,
} from "@/lib/demo-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const key = form.get("demoKey");

  if (typeof key !== "string" || !(await isValidDemoKey(key))) {
    return NextResponse.redirect(
      getPublicRequestUrl(request, "/access?error=1"),
      303,
    );
  }

  const response = NextResponse.redirect(getPublicRequestUrl(request, "/"), 303);
  response.cookies.set({
    name: DEMO_ACCESS_COOKIE,
    value: await getDemoSessionToken(),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 8 * 60 * 60,
    path: "/",
  });
  response.cookies.set({
    name: DEMO_SESSION_COOKIE,
    value: createDemoSessionId(),
    ...DEMO_SESSION_COOKIE_OPTIONS,
  });
  return response;
}
