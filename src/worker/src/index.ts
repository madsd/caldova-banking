import { DefaultAzureCredential } from "@azure/identity";
import { ServiceBusClient, type ProcessErrorArgs } from "@azure/service-bus";
import mssql from "mssql";
import { z } from "zod";
import {
  buildSalaryAllocation,
  parseApprovedRule,
} from "./salary-allocation.js";

const salaryEventSchema = z.object({
  type: z.literal("salary_posted"),
  eventId: z.string().uuid(),
  personaId: z.string().min(1),
  sessionId: z.string().uuid(),
  amount: z.number().positive().max(10_000_000),
  occurredAt: z.string().datetime(),
});

const namespace = required("SERVICE_BUS_NAMESPACE");
const queue = process.env.SERVICE_BUS_QUEUE ?? "bank-events";
const server = required("SQL_SERVER");
const database = required("SQL_DATABASE");
const credential = new DefaultAzureCredential();

async function openPool() {
  const token = await credential.getToken(
    "https://database.windows.net//.default",
  );
  if (!token) throw new Error("Could not acquire an Azure SQL token.");
  return new mssql.ConnectionPool({
    server,
    database,
    options: { encrypt: true, trustServerCertificate: false },
    authentication: {
      type: "azure-active-directory-access-token",
      options: { token: token.token },
    },
  }).connect();
}

async function prepareSalaryProposal(
  event: z.infer<typeof salaryEventSchema>,
) {
  const pool = await openPool();
  const transaction = new mssql.Transaction(pool);
  let transactionStarted = false;
  try {
    await transaction.begin(mssql.ISOLATION_LEVEL.SERIALIZABLE);
    transactionStarted = true;
    const accountResult = await new mssql.Request(transaction)
      .input("personaId", mssql.NVarChar(40), event.personaId)
      .query(`
        SELECT TOP 1
          a.id,
          a.display_name,
          a.masked_number
        FROM accounts a WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN account_holders h ON h.account_id = a.id
        WHERE h.customer_id = @personaId
        ORDER BY a.is_primary DESC, a.id;
      `);
    const account = accountResult.recordset[0] as
      | { id: string; display_name: string; masked_number: string }
      | undefined;
    if (!account) throw new Error("Customer account was not found.");

    const existing = await new mssql.Request(transaction)
      .input("eventId", mssql.NVarChar(128), event.eventId)
      .input("sessionId", mssql.UniqueIdentifier, event.sessionId)
      .query(`
        SELECT TOP 1 id
        FROM action_intents
        WHERE source_event_id = @eventId
          AND demo_session_id = @sessionId;
      `);
    if (existing.recordset.length > 0) {
      await transaction.commit();
      transactionStarted = false;
      return;
    }

    const ruleResult = await new mssql.Request(transaction)
      .input("personaId", mssql.NVarChar(40), event.personaId)
      .input("sessionId", mssql.UniqueIdentifier, event.sessionId)
      .query<{ rule_json: string }>(`
        SELECT TOP 1 rule_json
        FROM automation_rules
        WHERE customer_id = @personaId
          AND event_type = 'salary_posted'
          AND status = 'approved'
          AND demo_session_id = @sessionId
        ORDER BY approved_at DESC;
      `);
    const approvedRule = ruleResult.recordset[0]
      ? parseApprovedRule(ruleResult.recordset[0].rule_json)
      : undefined;
    const allocation = buildSalaryAllocation(event.amount, approvedRule);
    const intentId = crypto.randomUUID();
    const salaryTransactionId = `salary-event-${event.eventId}`;
    const salaryPostingId = crypto.randomUUID();
    const evidence = [
      {
        title: "Salary event received",
        detail: "The proposal was triggered by a real Azure Service Bus event.",
      },
      ...allocation.evidence,
      {
        title: "Approval required",
        detail: "The worker prepared a proposal and cannot execute it.",
      },
    ];

    await new mssql.Request(transaction)
      .input("transactionId", mssql.NVarChar(64), salaryTransactionId)
      .input("accountId", mssql.NVarChar(64), account.id)
      .input("amount", mssql.Decimal(18, 2), event.amount)
      .input("sessionId", mssql.UniqueIdentifier, event.sessionId)
      .query(`
        INSERT INTO customer_transactions (
          id, account_id, merchant, category, amount, currency,
          direction, note, booked_at, demo_session_id
        ) VALUES (
          @transactionId, @accountId, 'Salary', 'Incoming payment',
          @amount, 'UAH', 'credit', 'Salary event',
          SYSUTCDATETIME(), @sessionId
        );
      `);

    await new mssql.Request(transaction)
      .input("postingId", mssql.UniqueIdentifier, salaryPostingId)
      .input("transactionId", mssql.NVarChar(64), salaryTransactionId)
      .input("accountId", mssql.NVarChar(64), account.id)
      .input("amount", mssql.Decimal(18, 2), event.amount)
      .query(`
        INSERT INTO ledger_postings (id, customer_transaction_id, posted_at)
        VALUES (@postingId, @transactionId, SYSUTCDATETIME());

        INSERT INTO ledger_entries (
          posting_id, ledger_account_id, debit, credit
        ) VALUES
          (@postingId, 'PAYMENT-CLEARING', @amount, 0),
          (@postingId, CONCAT('CUSTOMER-LIABILITY:', @accountId), 0, @amount);
      `);

    await new mssql.Request(transaction)
      .input("id", mssql.UniqueIdentifier, intentId)
      .input("eventId", mssql.NVarChar(128), event.eventId)
      .input("personaId", mssql.NVarChar(40), event.personaId)
      .input("sessionId", mssql.UniqueIdentifier, event.sessionId)
      .input("title", mssql.NVarChar(120), "Apply salary allocation")
      .input("amount", mssql.Decimal(18, 2), allocation.movementAmount)
      .input("accountId", mssql.NVarChar(64), account.id)
      .input(
        "accountLabel",
        mssql.NVarChar(120),
        `${account.display_name} · ${account.masked_number}`,
      )
      .input(
        "fields",
        mssql.NVarChar(mssql.MAX),
        JSON.stringify(allocation.fields),
      )
      .input("evidence", mssql.NVarChar(mssql.MAX), JSON.stringify(evidence))
      .query(`
        INSERT INTO action_intents (
          id, customer_id, intent_type, title, status, amount, fee,
          source_account_id, source_account_label, destination_label,
          fields_json, evidence_json, created_at, source_event_id,
          demo_session_id
        ) VALUES (
          @id, @personaId, 'salary_allocation', @title, 'awaiting_approval',
          @amount, 0, @accountId, @accountLabel, 'Salary allocation plan',
          @fields, @evidence, SYSUTCDATETIME(), @eventId, @sessionId
        );
      `);
    await transaction.commit();
    transactionStarted = false;
  } catch (cause) {
    if (transactionStarted) await transaction.rollback();
    throw cause;
  } finally {
    await pool.close();
  }
}

const client = new ServiceBusClient(
  `${namespace}.servicebus.windows.net`,
  credential,
);
const receiver = client.createReceiver(queue);
const subscription = receiver.subscribe({
  processMessage: async (message) => {
    try {
      const event = salaryEventSchema.parse(message.body);
      await prepareSalaryProposal(event);
    } catch (cause) {
      console.error("Salary event processing failed", {
        messageId: message.messageId,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      throw cause;
    }
  },
  processError: async (args: ProcessErrorArgs) => {
    console.error("Service Bus processing error", {
      entityPath: args.entityPath,
      errorSource: args.errorSource,
      message: args.error.message,
    });
  },
});

console.log(`Salary proposal worker listening on ${queue}.`);

async function shutdown() {
  await subscription.close();
  await receiver.close();
  await client.close();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function formatUah(amount: number) {
  return `₴${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}
