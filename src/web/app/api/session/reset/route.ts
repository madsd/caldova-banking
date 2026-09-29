import { requireDemoSession } from "@/lib/demo-session";
import { resetDemoSession } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  await resetDemoSession(requireDemoSession(request));
  return Response.json({ reset: true });
}
