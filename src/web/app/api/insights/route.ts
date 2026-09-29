import { getAdaptiveInsights } from "@/lib/store";
import { requireDemoSession } from "@/lib/demo-session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const personaId = new URL(request.url).searchParams.get("personaId");
  if (!personaId) {
    return Response.json({ error: "personaId is required" }, { status: 400 });
  }
  try {
    return Response.json({
      insights: await getAdaptiveInsights(
        personaId,
        requireDemoSession(request),
      ),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Insights failed" },
      { status: 404 },
    );
  }
}
