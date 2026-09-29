export const DEMO_SESSION_COOKIE = "caldova_demo_session";

export const DEMO_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  maxAge: 8 * 60 * 60,
  path: "/",
};

export function createDemoSessionId() {
  return crypto.randomUUID();
}

export function isValidDemoSessionId(value?: string) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
  );
}

export function requireDemoSession(request: Request) {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${DEMO_SESSION_COOKIE}=`));
  const sessionId = cookie?.slice(DEMO_SESSION_COOKIE.length + 1);
  if (!isValidDemoSessionId(sessionId)) {
    throw new Error("Demo session is not initialized. Reload the application.");
  }
  return sessionId!;
}
