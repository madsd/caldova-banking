import { z } from "zod";
import { runBankingAgent } from "@/lib/agent";
import type { AgentEvent } from "@/lib/types";
import { requireDemoSession } from "@/lib/demo-session";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  personaId: z.string().min(1),
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(4000),
      }),
    )
    .max(12)
    .default([]),
});

export async function POST(request: Request) {
  const sessionId = requireDemoSession(request);
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "A persona and message are required." },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };
      try {
        await runBankingAgent(
          parsed.data.personaId,
          parsed.data.message,
          send,
          sessionId,
          parsed.data.history,
        );
      } catch (error) {
        send({
          type: "error",
          message:
            error instanceof z.ZodError
              ? "I need a valid amount or account detail before I can prepare that action."
              : error instanceof Error
              ? error.message
              : "The banking agent failed.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
    },
  });
}
