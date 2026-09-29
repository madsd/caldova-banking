import { ServiceBusClient } from "@azure/service-bus";
import { DefaultAzureCredential } from "@azure/identity";
import { getDashboard, prepareSalaryEventAllocation } from "@/lib/store";
import { requireDemoSession } from "@/lib/demo-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const sessionId = requireDemoSession(request);
  const { personaId, amount } = (await request.json()) as {
    personaId?: string;
    amount?: number;
  };
  if (!personaId) {
    return Response.json({ error: "personaId is required" }, { status: 400 });
  }

  const salary =
    amount ??
    (await getDashboard(personaId, sessionId)).transactions.find(
      (transaction) =>
        transaction.direction === "credit" &&
        [transaction.merchant, transaction.category, transaction.note].some(
          (value) => /salary|payroll/i.test(value),
        ),
    )?.amount;
  if (!salary || !Number.isFinite(salary) || salary <= 0) {
    return Response.json(
      { error: "No verified salary amount is available for this customer." },
      { status: 400 },
    );
  }

  const namespace = process.env.SERVICE_BUS_NAMESPACE;
  if (!namespace) {
    return Response.json({
      mode: "local-preview",
      intent: await prepareSalaryEventAllocation(personaId, salary, sessionId),
    });
  }

  const client = new ServiceBusClient(
    `${namespace}.servicebus.windows.net`,
    new DefaultAzureCredential(),
  );
  const sender = client.createSender(
    process.env.SERVICE_BUS_QUEUE ?? "bank-events",
  );
  try {
    const eventId = crypto.randomUUID();
    await sender.sendMessages({
      body: {
        type: "salary_posted",
        eventId,
        personaId,
        amount: salary,
        sessionId,
        occurredAt: new Date().toISOString(),
      },
      messageId: eventId,
      subject: "salary_posted",
      contentType: "application/json",
    });
    return Response.json(
      { mode: "service-bus", accepted: true, eventId },
      { status: 202 },
    );
  } finally {
    await sender.close();
    await client.close();
  }
}
