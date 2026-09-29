import { z } from "zod";
import {
  listPendingIntents,
  prepareMoneyMovement,
} from "@/lib/store";
import { requireDemoSession } from "@/lib/demo-session";

export const runtime = "nodejs";

const moneyMovementSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("own_account_transfer"),
    personaId: z.string().min(1),
    sourceAccountId: z.string().min(1),
    destinationAccountId: z.string().min(1),
    amount: z.number().positive(),
  }),
  z.object({
    kind: z.literal("mobile_topup"),
    personaId: z.string().min(1),
    sourceAccountId: z.string().min(1),
    phone: z.string().min(5),
    amount: z.number().positive().max(5000),
    provenance: z
      .enum(["customer_instruction", "history_match"])
      .default("customer_instruction"),
  }),
  z.object({
    kind: z.literal("bill_payment"),
    personaId: z.string().min(1),
    sourceAccountId: z.string().min(1),
    payee: z.string().trim().min(1).max(200),
    amount: z.number().positive(),
    reference: z.string().trim().min(1).max(160).optional(),
    dueDate: z.string().trim().min(1).max(80).optional(),
    provenance: z
      .enum(["customer_instruction", "invoice_upload"])
      .default("customer_instruction"),
  }),
]);

export async function GET(request: Request) {
  const personaId = new URL(request.url).searchParams.get("personaId");
  if (!personaId) {
    return Response.json({ error: "personaId is required" }, { status: 400 });
  }
  return Response.json({
    intents: await listPendingIntents(personaId, requireDemoSession(request)),
  });
}

export async function POST(request: Request) {
  const parsed = moneyMovementSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "A valid money movement request is required." },
      { status: 400 },
    );
  }

  const { personaId, ...movement } = parsed.data;
  try {
    return Response.json({
      intent: await prepareMoneyMovement(
        personaId,
        movement,
        requireDemoSession(request),
      ),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Money movement preparation failed.",
      },
      { status: 409 },
    );
  }
}
