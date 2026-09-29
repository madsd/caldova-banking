import {
  listAdvisorMessages,
  prepareAdvisorMessage,
} from "@/lib/store";
import { requireDemoSession } from "@/lib/demo-session";
import { advisorTopics, type AdvisorTopic } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const personaId = new URL(request.url).searchParams.get("personaId");
  if (!personaId) {
    return Response.json({ error: "personaId is required" }, { status: 400 });
  }
  return Response.json({
    messages: await listAdvisorMessages(
      personaId,
      requireDemoSession(request),
    ),
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    personaId?: string;
    topic?: AdvisorTopic;
    message?: string;
  };
  const message = body.message?.trim();
  if (
    !body.personaId ||
    !body.topic ||
    !advisorTopics.includes(body.topic) ||
    !message
  ) {
    return Response.json(
      { error: "personaId, topic, and message are required" },
      { status: 400 },
    );
  }
  try {
    return Response.json({
      message: await prepareAdvisorMessage(
        body.personaId,
        body.topic,
        message,
        [],
        requireDemoSession(request),
      ),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Advisor message draft failed",
      },
      { status: 400 },
    );
  }
}
