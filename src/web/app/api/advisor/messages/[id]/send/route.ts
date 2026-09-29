import { requireDemoSession } from "@/lib/demo-session";
import { sendAdvisorMessage } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { personaId } = (await request.json()) as { personaId?: string };
  if (!personaId) {
    return Response.json({ error: "personaId is required" }, { status: 400 });
  }
  try {
    const { id } = await context.params;
    return Response.json({
      message: await sendAdvisorMessage(
        personaId,
        id,
        requireDemoSession(request),
      ),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Advisor message send failed",
      },
      { status: 409 },
    );
  }
}
