export const DEMO_ACCESS_COOKIE = "caldova_demo_access";

const SESSION_MARKER = "caldova-demo-authorized";

export function getPublicRequestUrl(request: Request, path: string) {
  const requestUrl = new URL(request.url);
  const configuredOrigin = process.env.DEMO_PUBLIC_ORIGIN;
  if (configuredOrigin) {
    return new URL(path, configuredOrigin);
  }
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const host = forwardedHost ?? firstHeaderValue(request.headers.get("host"));
  const forwardedProtocol = firstHeaderValue(
    request.headers.get("x-forwarded-proto"),
  );
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : requestUrl.protocol.slice(0, -1);

  if (!host || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) {
    return new URL(path, requestUrl);
  }

  return new URL(path, `${protocol}://${host}`);
}

export function normalizeDemoKey(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

export async function hashDemoKey(value: string) {
  const bytes = new TextEncoder().encode(normalizeDemoKey(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function isValidDemoKey(value: string) {
  const expectedHash = process.env.DEMO_ACCESS_KEY_HASH;
  if (!expectedHash) {
    return false;
  }
  return constantTimeEqual(await hashDemoKey(value), expectedHash);
}

export async function getDemoSessionToken() {
  const expectedHash = process.env.DEMO_ACCESS_KEY_HASH;
  if (!expectedHash) {
    return "";
  }
  return hashDemoKey(`${expectedHash}:${SESSION_MARKER}`);
}

export async function hasValidDemoSession(value?: string) {
  if (!value) {
    return false;
  }
  return constantTimeEqual(value, await getDemoSessionToken());
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function firstHeaderValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || undefined;
}
