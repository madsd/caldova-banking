import { DefaultAzureCredential } from "@azure/identity";
import sql from "mssql";
import { createBalancedPostings } from "@/lib/ledger";
import type {
  ActionIntent,
  AdvisorMessage,
  AgentPlan,
  Dashboard,
  Evidence,
  Transaction,
} from "@/lib/types";

type CachedPool = {
  pool: sql.ConnectionPool;
  expiresAt: number;
};

declare global {
  var caldovaSqlPool: CachedPool | undefined;
  var caldovaSqlPoolPromise: Promise<CachedPool> | undefined;
}

function sqlConfigured() {
  return Boolean(process.env.SQL_SERVER && process.env.SQL_DATABASE);
}

export function isSqlStoreConfigured() {
  return sqlConfigured();
}

async function getPool() {
  if (
    globalThis.caldovaSqlPool &&
    globalThis.caldovaSqlPool.expiresAt > Date.now() + 5 * 60 * 1000
  ) {
    return globalThis.caldovaSqlPool.pool;
  }

  if (!globalThis.caldovaSqlPoolPromise) {
    globalThis.caldovaSqlPoolPromise = createPool();
  }

  const pendingPool = globalThis.caldovaSqlPoolPromise;
  try {
    globalThis.caldovaSqlPool = await pendingPool;
    return globalThis.caldovaSqlPool.pool;
  } finally {
    if (globalThis.caldovaSqlPoolPromise === pendingPool) {
      globalThis.caldovaSqlPoolPromise = undefined;
    }
  }
}

async function createPool(): Promise<CachedPool> {
  if (globalThis.caldovaSqlPool) {
    await globalThis.caldovaSqlPool.pool.close();
    globalThis.caldovaSqlPool = undefined;
  }

  const credential = new DefaultAzureCredential({
    managedIdentityClientId: process.env.AZURE_CLIENT_ID,
  });
  const accessToken = await credential.getToken(
    "https://database.windows.net//.default",
  );
  if (!accessToken) {
    throw new Error("Azure SQL access token could not be acquired.");
  }

  const pool = await new sql.ConnectionPool({
    server: process.env.SQL_SERVER!,
    database: process.env.SQL_DATABASE!,
    connectionTimeout: 60_000,
    requestTimeout: 30_000,
    authentication: {
      type: "azure-active-directory-access-token",
      options: { token: accessToken.token },
    },
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30_000,
    },
  }).connect();

  return {
    pool,
    expiresAt: accessToken.expiresOnTimestamp,
  };
}

export async function sqlListPersonas() {
  const result = await (await getPool()).request().query<{
    id: string;
    name: string;
    initials: string;
    descriptor: string;
    advisorName: string;
    advisorInitials: string;
  }>(`
    SELECT
      id,
      display_name AS name,
      initials,
      descriptor,
      advisor_name AS advisorName,
      advisor_initials AS advisorInitials
    FROM customers
    ORDER BY sort_order;
  `);
  return result.recordset;
}

export async function sqlGetDashboard(
  personaId: string,
  sessionId: string,
): Promise<Dashboard> {
  const pool = await getPool();
  const profile = await pool
    .request()
    .input("personaId", sql.NVarChar(40), personaId)
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .query<{
      personaId: string;
      personaName: string;
      initials: string;
      descriptor: string;
      advisorName: string;
      advisorInitials: string;
      accountId: string;
      accountName: string;
      maskedNumber: string;
      balance: number;
      phone: string;
    }>(`
      SELECT TOP 1
        c.id AS personaId,
        c.display_name AS personaName,
        c.initials,
        c.descriptor,
        c.advisor_name AS advisorName,
        c.advisor_initials AS advisorInitials,
        a.id AS accountId,
        a.display_name AS accountName,
        a.masked_number AS maskedNumber,
        CAST(a.balance + COALESCE((
          SELECT SUM(CASE WHEN st.direction = 'credit' THEN st.amount ELSE -st.amount END)
          FROM customer_transactions st
          WHERE st.account_id = a.id AND st.demo_session_id = @sessionId
        ), 0) AS decimal(18,2)) AS balance,
        m.masked_number AS phone
      FROM customers c
      INNER JOIN account_holders ah ON ah.customer_id = c.id
      INNER JOIN accounts a ON a.id = ah.account_id AND a.is_primary = 1
      LEFT JOIN mobile_numbers m ON m.customer_id = c.id AND m.is_primary = 1
      WHERE c.id = @personaId;
    `);
  const row = profile.recordset[0];
  if (!row) {
    throw new Error(`Unknown persona: ${personaId}`);
  }

  const accountResult = await pool
    .request()
    .input("personaId", sql.NVarChar(40), personaId)
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .query<{
      id: string;
      name: string;
      maskedNumber: string;
      balance: number;
      currency: Dashboard["account"]["currency"];
      type: Dashboard["account"]["type"];
      network: Dashboard["account"]["network"];
    }>(`
      SELECT
        a.id,
        a.display_name AS name,
        COALESCE(card.masked_pan, a.masked_number) AS maskedNumber,
        CAST(a.balance + COALESCE((
          SELECT SUM(CASE WHEN st.direction = 'credit' THEN st.amount ELSE -st.amount END)
          FROM customer_transactions st
          WHERE st.account_id = a.id AND st.demo_session_id = @sessionId
        ), 0) AS decimal(18,2)) AS balance,
        a.currency,
        a.account_type AS type,
        card.network
      FROM account_holders ah
      INNER JOIN accounts a ON a.id = ah.account_id
      OUTER APPLY (
        SELECT TOP 1 masked_pan, network
        FROM cards
        WHERE account_id = a.id AND card_status = 'active'
        ORDER BY id
      ) card
      WHERE ah.customer_id = @personaId
      ORDER BY a.is_primary DESC, a.display_name;
    `);
  const accounts = accountResult.recordset.map((account) => ({
    ...account,
    balance: Number(account.balance),
    network: account.network ?? undefined,
  }));
  const primaryAccount = accounts.find((account) => account.id === row.accountId);
  if (!primaryAccount) {
    throw new Error(`Primary account not found for persona: ${personaId}`);
  }

  const transactionResult = await pool
    .request()
    .input("personaId", sql.NVarChar(40), personaId)
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .query<{
      id: string;
      accountId: string;
      merchant: string;
      category: string;
      amount: number;
      currency: Transaction["currency"];
      bookedAt: Date;
      direction: "credit" | "debit";
      note: string;
    }>(`
      SELECT TOP 200
        t.id,
        t.account_id AS accountId,
        t.merchant,
        t.category,
        t.amount,
        t.currency,
        t.booked_at AS bookedAt,
        t.direction,
        t.note
      FROM customer_transactions t
      INNER JOIN account_holders ah ON ah.account_id = t.account_id
      WHERE ah.customer_id = @personaId
        AND (t.demo_session_id IS NULL OR t.demo_session_id = @sessionId)
      ORDER BY t.booked_at DESC;
    `);

  return {
    persona: {
      id: row.personaId,
      name: row.personaName,
      initials: row.initials,
      descriptor: row.descriptor,
      advisorName: row.advisorName,
      advisorInitials: row.advisorInitials,
    },
    account: primaryAccount,
    accounts,
    phone: row.phone,
    transactions: transactionResult.recordset.map(mapTransaction),
    aiMode: process.env.FOUNDRY_PROJECT_ENDPOINT
      ? "foundry"
      : "local-preview",
  };
}

export async function sqlGetLastMobileTopup(
  personaId: string,
  sessionId: string,
) {
  const result = await (await getPool())
    .request()
    .input("personaId", sql.NVarChar(40), personaId)
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .query<{
      amount: number;
      phone: string;
      operator: string;
      bookedAt: Date;
      transactionId: string;
    }>(`
      SELECT TOP 1
        t.amount,
        mt.masked_phone AS phone,
        mt.operator,
        t.booked_at AS bookedAt,
        t.id AS transactionId
      FROM mobile_topups mt
      INNER JOIN customer_transactions t ON t.id = mt.transaction_id
      WHERE mt.customer_id = @personaId
        AND (t.demo_session_id IS NULL OR t.demo_session_id = @sessionId)
        AND mt.status = 'completed'
      ORDER BY t.booked_at DESC;
    `);
  const item = result.recordset[0];
  return item
    ? {
        ...item,
        amount: Number(item.amount),
        bookedAt: item.bookedAt.toISOString(),
      }
    : null;
}

export async function sqlSearchTransactions(
  personaId: string,
  query: string,
  sessionId: string,
) {
  const normalized = `%${query}%`;
  const result = await (await getPool())
    .request()
    .input("personaId", sql.NVarChar(40), personaId)
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .input("query", sql.NVarChar(200), normalized)
    .query<{
      id: string;
      accountId: string;
      merchant: string;
      category: string;
      amount: number;
      currency: Transaction["currency"];
      bookedAt: Date;
      direction: "credit" | "debit";
      note: string;
    }>(`
      SELECT TOP 20
        t.id,
        t.account_id AS accountId,
        t.merchant,
        t.category,
        t.amount,
        t.currency,
        t.booked_at AS bookedAt,
        t.direction,
        t.note
      FROM customer_transactions t
      INNER JOIN account_holders ah ON ah.account_id = t.account_id
      WHERE ah.customer_id = @personaId
        AND (t.demo_session_id IS NULL OR t.demo_session_id = @sessionId)
        AND (
          t.merchant LIKE @query OR
          t.category LIKE @query OR
          t.note LIKE @query
        )
      ORDER BY t.booked_at DESC;
    `);
  return result.recordset.map(mapTransaction);
}

export async function sqlCreateIntent(intent: ActionIntent, sessionId: string) {
  await (await getPool())
    .request()
    .input("id", sql.UniqueIdentifier, intent.id)
    .input("personaId", sql.NVarChar(40), intent.personaId)
    .input("type", sql.NVarChar(40), intent.type)
    .input("title", sql.NVarChar(120), intent.title)
    .input("status", sql.NVarChar(40), intent.status)
    .input("amount", sql.Decimal(18, 2), intent.amount)
    .input("fee", sql.Decimal(18, 2), intent.fee)
    .input("sourceAccountId", sql.NVarChar(64), intent.sourceAccountId)
    .input("sourceAccountLabel", sql.NVarChar(120), intent.sourceAccountLabel)
    .input(
      "destinationAccountId",
      sql.NVarChar(64),
      intent.destinationAccountId ?? null,
    )
    .input("destinationLabel", sql.NVarChar(200), intent.destinationLabel)
    .input("fieldsJson", sql.NVarChar(sql.MAX), JSON.stringify(intent.fields))
    .input("evidenceJson", sql.NVarChar(sql.MAX), JSON.stringify(intent.evidence))
    .input("createdAt", sql.DateTime2, new Date(intent.createdAt))
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .query(`
      INSERT INTO action_intents (
        id, customer_id, intent_type, title, status, amount, fee,
        source_account_id, source_account_label, destination_account_id,
        destination_label,
        fields_json, evidence_json, created_at, demo_session_id
      ) VALUES (
        @id, @personaId, @type, @title, @status, @amount, @fee,
        @sourceAccountId, @sourceAccountLabel, @destinationAccountId,
        @destinationLabel,
        @fieldsJson, @evidenceJson, @createdAt, @sessionId
      );
    `);
  return intent;
}

export async function sqlListPendingIntents(
  personaId: string,
  sessionId: string,
) {
  const result = await (await getPool())
    .request()
    .input("personaId", sql.NVarChar(40), personaId)
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .query<IntentRow>(`
      SELECT TOP 20 *
      FROM action_intents
      WHERE customer_id = @personaId
        AND demo_session_id = @sessionId
        AND status = 'awaiting_approval'
      ORDER BY created_at DESC;
    `);
  return result.recordset.map(mapIntent);
}

export async function sqlCreateAdvisorMessage(
  message: AdvisorMessage,
  sessionId: string,
) {
  await (await getPool())
    .request()
    .input("id", sql.UniqueIdentifier, message.id)
    .input("personaId", sql.NVarChar(40), message.personaId)
    .input("status", sql.NVarChar(40), message.status)
    .input("topic", sql.NVarChar(500), message.topic)
    .input("body", sql.NVarChar(sql.MAX), message.body)
    .input("evidenceJson", sql.NVarChar(sql.MAX), JSON.stringify(message.evidence))
    .input("createdAt", sql.DateTime2, new Date(message.createdAt))
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .query(`
      INSERT INTO advisor_messages (
        id, customer_id, status, topic, body, evidence_json,
        created_at, demo_session_id
      ) VALUES (
        @id, @personaId, @status, @topic, @body, @evidenceJson,
        @createdAt, @sessionId
      );
    `);
  return message;
}

export async function sqlListAdvisorMessages(
  personaId: string,
  sessionId: string,
) {
  const result = await (await getPool())
    .request()
    .input("personaId", sql.NVarChar(40), personaId)
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .query<{
      id: string;
      customer_id: string;
      status: AdvisorMessage["status"];
      topic: string;
      body: string;
      evidence_json: string;
      created_at: Date;
      sent_at: Date | null;
    }>(`
      SELECT
        id, customer_id, status, topic, body, evidence_json, created_at, sent_at
      FROM advisor_messages
      WHERE customer_id = @personaId AND demo_session_id = @sessionId
      ORDER BY created_at DESC;
    `);
  return result.recordset.map((row) => ({
    id: row.id,
    personaId: row.customer_id,
    status: row.status,
    topic: row.topic as AdvisorMessage["topic"],
    body: row.body,
    evidence: JSON.parse(row.evidence_json) as Evidence[],
    createdAt: row.created_at.toISOString(),
    sentAt: row.sent_at?.toISOString(),
  }));
}

export async function sqlSendAdvisorMessage(
  personaId: string,
  messageId: string,
  sessionId: string,
) {
  const result = await (await getPool())
    .request()
    .input("id", sql.UniqueIdentifier, messageId)
    .input("personaId", sql.NVarChar(40), personaId)
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .query<{
      id: string;
      customer_id: string;
      status: AdvisorMessage["status"];
      topic: string;
      body: string;
      evidence_json: string;
      created_at: Date;
      sent_at: Date;
    }>(`
      UPDATE advisor_messages
      SET status = 'sent', sent_at = SYSUTCDATETIME()
      OUTPUT
        inserted.id,
        inserted.customer_id,
        inserted.status,
        inserted.topic,
        inserted.body,
        inserted.evidence_json,
        inserted.created_at,
        inserted.sent_at
      WHERE id = @id
        AND customer_id = @personaId
        AND demo_session_id = @sessionId
        AND status = 'draft';
    `);
  const row = result.recordset[0];
  if (!row) {
    throw new Error("Advisor message draft was not found or was already sent.");
  }
  return {
    id: row.id,
    personaId: row.customer_id,
    status: row.status,
    topic: row.topic as AdvisorMessage["topic"],
    body: row.body,
    evidence: JSON.parse(row.evidence_json) as Evidence[],
    createdAt: row.created_at.toISOString(),
    sentAt: row.sent_at.toISOString(),
  } satisfies AdvisorMessage;
}

export async function sqlGetAgentPlan(
  personaId: string,
  sessionId: string,
): Promise<AgentPlan | null> {
  const result = await (await getPool())
    .request()
    .input("personaId", sql.NVarChar(40), personaId)
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .query<{ plan_json: string }>(`
      SELECT TOP 1 plan_json
      FROM agent_plans
      WHERE customer_id = @personaId AND demo_session_id = @sessionId;
    `);
  const row = result.recordset[0];
  return row ? (JSON.parse(row.plan_json) as AgentPlan) : null;
}

export async function sqlSaveAgentPlan(
  personaId: string,
  plan: AgentPlan,
  sessionId: string,
) {
  await (await getPool())
    .request()
    .input("id", sql.UniqueIdentifier, plan.id)
    .input("personaId", sql.NVarChar(40), personaId)
    .input("status", sql.NVarChar(40), plan.status)
    .input("planJson", sql.NVarChar(sql.MAX), JSON.stringify(plan))
    .input("updatedAt", sql.DateTime2, new Date(plan.updatedAt))
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .query(`
      MERGE agent_plans AS target
      USING (
        SELECT @personaId AS customer_id, @sessionId AS demo_session_id
      ) AS source
      ON target.customer_id = source.customer_id
        AND target.demo_session_id = source.demo_session_id
      WHEN MATCHED THEN UPDATE SET
        id = @id,
        status = @status,
        plan_json = @planJson,
        updated_at = @updatedAt
      WHEN NOT MATCHED THEN INSERT (
        id, customer_id, status, plan_json, updated_at, demo_session_id
      ) VALUES (
        @id, @personaId, @status, @planJson, @updatedAt, @sessionId
      );
    `);
  return plan;
}

export async function sqlApproveIntent(
  personaId: string,
  intentId: string,
  sessionId: string,
): Promise<{ intent: ActionIntent; dashboard: Dashboard }> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const intentResult = await new sql.Request(transaction)
      .input("intentId", sql.UniqueIdentifier, intentId)
      .input("personaId", sql.NVarChar(40), personaId)
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .query<IntentRow>(`
        SELECT *
        FROM action_intents WITH (UPDLOCK, ROWLOCK)
        WHERE id = @intentId
          AND customer_id = @personaId
          AND demo_session_id = @sessionId;
      `);
    const intentRow = intentResult.recordset[0];
    if (!intentRow) {
      throw new Error("Intent not found for this persona.");
    }
    if (intentRow.status !== "awaiting_approval") {
      throw new Error(`Intent cannot be approved from ${intentRow.status}.`);
    }

    const accountResult = await new sql.Request(transaction)
      .input("accountId", sql.NVarChar(64), intentRow.source_account_id)
      .input("personaId", sql.NVarChar(40), personaId)
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .query<{
        id: string;
        balance: number;
        currency: Transaction["currency"];
      }>(`
        SELECT
          a.id,
          a.currency,
          CAST(a.balance + COALESCE((
          SELECT SUM(CASE WHEN st.direction = 'credit' THEN st.amount ELSE -st.amount END)
          FROM customer_transactions st
          WHERE st.account_id = a.id AND st.demo_session_id = @sessionId
        ), 0) AS decimal(18,2)) AS balance
        FROM accounts a WITH (UPDLOCK, ROWLOCK)
        INNER JOIN account_holders ah ON ah.account_id = a.id
        WHERE a.id = @accountId
          AND ah.customer_id = @personaId;
      `);
    const sourceAccount = accountResult.recordset[0];
    if (!sourceAccount) {
      throw new Error("Source account is no longer available.");
    }
    const balance = Number(sourceAccount.balance);
    const total = Number(intentRow.amount) + Number(intentRow.fee);
    const [debitPosting, creditPosting] = createBalancedPostings(
      Number(intentRow.amount),
      Number(intentRow.fee),
    );
    if (
      intentRow.intent_type !== "salary_rule" &&
      (!Number.isFinite(balance) || balance < total)
    ) {
      throw new Error("Insufficient balance for this action.");
    }
    if (
      intentRow.intent_type === "mobile_topup" &&
      Number(intentRow.amount) > 5000
    ) {
      throw new Error("Top-up exceeds the synthetic daily limit.");
    }
    let destinationAccount:
      | { id: string; currency: Transaction["currency"] }
      | undefined;
    if (intentRow.intent_type === "account_transfer") {
      if (!intentRow.destination_account_id) {
        throw new Error("Destination account is missing from this transfer.");
      }
      const destinationResult = await new sql.Request(transaction)
        .input(
          "destinationAccountId",
          sql.NVarChar(64),
          intentRow.destination_account_id,
        )
        .input("personaId", sql.NVarChar(40), personaId)
        .query<{ id: string; currency: Transaction["currency"] }>(`
          SELECT a.id, a.currency
          FROM accounts a WITH (UPDLOCK, ROWLOCK)
          INNER JOIN account_holders ah ON ah.account_id = a.id
          WHERE a.id = @destinationAccountId
            AND ah.customer_id = @personaId;
        `);
      destinationAccount = destinationResult.recordset[0];
      if (!destinationAccount) {
        throw new Error("Destination account is no longer available.");
      }
      if (destinationAccount.id === sourceAccount.id) {
        throw new Error("Choose two different accounts for the transfer.");
      }
      if (destinationAccount.currency !== sourceAccount.currency) {
        throw new Error("The transfer accounts no longer use the same currency.");
      }
    }

    const idempotencyKey = `${sessionId}:${personaId}:${intentId}`;
    const existing = await new sql.Request(transaction)
      .input("idempotencyKey", sql.NVarChar(200), idempotencyKey)
      .query<{ idempotency_key: string }>(`
        SELECT idempotency_key
        FROM execution_idempotency WITH (UPDLOCK, HOLDLOCK)
        WHERE idempotency_key = @idempotencyKey;
      `);
    if (existing.recordset.length > 0) {
      throw new Error("This intent has already been executed.");
    }

    const transactionId = crypto.randomUUID();
    const destinationTransactionId = crypto.randomUUID();
    const postingId = crypto.randomUUID();
    const receipt = `P24-${new Date()
      .toISOString()
      .slice(0, 10)
      .replaceAll("-", "")}-${intentId.slice(0, 8).toUpperCase()}`;
    const merchant =
      intentRow.intent_type === "mobile_topup"
        ? "Kyivstar"
        : intentRow.intent_type === "bill_payment"
          ? intentRow.destination_label
          : intentRow.intent_type === "account_transfer"
            ? intentRow.destination_label
          : "Caldova automation";
    const category =
      intentRow.intent_type === "mobile_topup"
        ? "Mobile top-up"
        : intentRow.intent_type === "bill_payment"
          ? "Bills"
          : intentRow.intent_type === "account_transfer"
            ? "Transfer"
          : "Savings allocation";

    if (intentRow.intent_type === "salary_rule") {
      await new sql.Request(transaction)
        .input("personaId", sql.NVarChar(40), personaId)
        .input("ruleJson", sql.NVarChar(sql.MAX), intentRow.fields_json)
        .input("sessionId", sql.UniqueIdentifier, sessionId)
        .query(`
          INSERT INTO automation_rules (
            customer_id, event_type, rule_json, status, approved_at,
            demo_session_id
          ) VALUES (
            @personaId, 'salary_posted', @ruleJson, 'approved',
            SYSUTCDATETIME(), @sessionId
          );
        `);
    } else if (intentRow.intent_type === "salary_allocation") {
      await executeSqlSalaryAllocation(
        transaction,
        personaId,
        sessionId,
        intentRow,
        sourceAccount.currency,
      );
    } else {
      await new sql.Request(transaction)
        .input("transactionId", sql.NVarChar(64), transactionId)
        .input("accountId", sql.NVarChar(64), intentRow.source_account_id)
        .input("merchant", sql.NVarChar(160), merchant)
        .input("category", sql.NVarChar(80), category)
        .input("amount", sql.Decimal(18, 2), total)
        .input("note", sql.NVarChar(240), intentRow.destination_label)
        .input("sessionId", sql.UniqueIdentifier, sessionId)
        .query(`
          INSERT INTO customer_transactions (
            id, account_id, merchant, category, amount, currency,
            direction, note, booked_at, demo_session_id
          ) VALUES (
            @transactionId, @accountId, @merchant, @category, @amount,
            'UAH', 'debit', @note, SYSUTCDATETIME(), @sessionId
          );
        `);

      const ledgerRequest = new sql.Request(transaction)
        .input("postingId", sql.UniqueIdentifier, postingId)
        .input("transactionId", sql.NVarChar(64), transactionId)
        .input("accountId", sql.NVarChar(64), intentRow.source_account_id)
        .input("debitAmount", sql.Decimal(18, 2), debitPosting.amount)
        .input("creditAmount", sql.Decimal(18, 2), creditPosting.amount);
      if (intentRow.intent_type === "account_transfer") {
        await ledgerRequest
          .input(
            "destinationAccountId",
            sql.NVarChar(64),
            destinationAccount!.id,
          )
          .query(`
            INSERT INTO ledger_postings (id, customer_transaction_id, posted_at)
            VALUES (@postingId, @transactionId, SYSUTCDATETIME());

            INSERT INTO ledger_entries (
              posting_id, ledger_account_id, debit, credit
            ) VALUES
              (@postingId, CONCAT('CUSTOMER-LIABILITY:', @accountId), @debitAmount, 0),
              (@postingId, CONCAT('CUSTOMER-LIABILITY:', @destinationAccountId), 0, @creditAmount);
          `);

        await new sql.Request(transaction)
          .input(
            "destinationTransactionId",
            sql.NVarChar(64),
            destinationTransactionId,
          )
          .input(
            "destinationAccountId",
            sql.NVarChar(64),
            destinationAccount!.id,
          )
          .input("merchant", sql.NVarChar(160), intentRow.source_account_label)
          .input("amount", sql.Decimal(18, 2), intentRow.amount)
          .input("currency", sql.NVarChar(3), destinationAccount!.currency)
          .input("note", sql.NVarChar(240), intentRow.source_account_label)
          .input("sessionId", sql.UniqueIdentifier, sessionId)
          .query(`
            INSERT INTO customer_transactions (
              id, account_id, merchant, category, amount, currency,
              direction, note, booked_at, demo_session_id
            ) VALUES (
              @destinationTransactionId, @destinationAccountId, @merchant,
              'Transfer', @amount, @currency, 'credit', @note,
              SYSUTCDATETIME(), @sessionId
            );
          `);
      } else {
        await ledgerRequest.query(`
          INSERT INTO ledger_postings (id, customer_transaction_id, posted_at)
          VALUES (@postingId, @transactionId, SYSUTCDATETIME());

          INSERT INTO ledger_entries (
            posting_id, ledger_account_id, debit, credit
          ) VALUES
            (@postingId, CONCAT('CUSTOMER-LIABILITY:', @accountId), @debitAmount, 0),
            (@postingId, 'PAYMENT-CLEARING', 0, @creditAmount);
        `);
      }
    }

    await new sql.Request(transaction)
      .input("intentId", sql.UniqueIdentifier, intentId)
      .input("receipt", sql.NVarChar(80), receipt)
      .input("personaId", sql.NVarChar(40), personaId)
      .input("idempotencyKey", sql.NVarChar(200), idempotencyKey)
      .query(`
        INSERT INTO approvals (
          id, action_intent_id, customer_id, decision, decided_at
        ) VALUES (
          NEWID(), @intentId, @personaId, 'approved', SYSUTCDATETIME()
        );

        INSERT INTO execution_idempotency (
          idempotency_key, action_intent_id, created_at
        ) VALUES (
          @idempotencyKey, @intentId, SYSUTCDATETIME()
        );

        UPDATE action_intents
        SET status = 'completed', receipt = @receipt,
            completed_at = SYSUTCDATETIME()
        WHERE id = @intentId;
      `);

    if (intentRow.intent_type === "mobile_topup") {
      await new sql.Request(transaction)
        .input("transactionId", sql.NVarChar(64), transactionId)
        .input("personaId", sql.NVarChar(40), personaId)
        .input("maskedPhone", sql.NVarChar(40), intentRow.destination_label)
        .query(`
          INSERT INTO mobile_topups (
            id, transaction_id, customer_id, operator, masked_phone,
            status, provider_reference
          ) VALUES (
            NEWID(), @transactionId, @personaId, 'Kyivstar',
            @maskedPhone, 'completed', NEWID()
          );
        `);
    }

    await transaction.commit();
    const completedIntent = mapIntent({
      ...intentRow,
      status: "completed",
      receipt,
    });
    return {
      intent: completedIntent,
      dashboard: await sqlGetDashboard(personaId, sessionId),
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function sqlResetDemoSession(sessionId: string) {
  await (await getPool())
    .request()
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .query(`
      DELETE mt
      FROM mobile_topups mt
      INNER JOIN customer_transactions ct ON ct.id = mt.transaction_id
      WHERE ct.demo_session_id = @sessionId;

      DELETE le
      FROM ledger_entries le
      INNER JOIN ledger_postings lp ON lp.id = le.posting_id
      INNER JOIN customer_transactions ct ON ct.id = lp.customer_transaction_id
      WHERE ct.demo_session_id = @sessionId;

      DELETE lp
      FROM ledger_postings lp
      INNER JOIN customer_transactions ct ON ct.id = lp.customer_transaction_id
      WHERE ct.demo_session_id = @sessionId;

      DELETE a
      FROM approvals a
      INNER JOIN action_intents ai ON ai.id = a.action_intent_id
      WHERE ai.demo_session_id = @sessionId;

      DELETE ei
      FROM execution_idempotency ei
      INNER JOIN action_intents ai ON ai.id = ei.action_intent_id
      WHERE ai.demo_session_id = @sessionId;

      DELETE FROM customer_transactions
      WHERE demo_session_id = @sessionId;

      DELETE FROM automation_rules
      WHERE demo_session_id = @sessionId;

      DELETE FROM advisor_messages
      WHERE demo_session_id = @sessionId;

      DELETE FROM agent_plans
      WHERE demo_session_id = @sessionId;

      DELETE FROM action_intents
      WHERE demo_session_id = @sessionId;
    `);
}

type IntentRow = {
  id: string;
  customer_id: string;
  intent_type: ActionIntent["type"];
  title: string;
  status: ActionIntent["status"];
  amount: number;
  fee: number;
  source_account_id: string;
  source_account_label: string;
  destination_account_id?: string;
  destination_label: string;
  source_event_id?: string;
  fields_json: string;
  evidence_json: string;
  created_at: Date;
  receipt?: string;
};

function mapIntent(row: IntentRow): ActionIntent {
  return {
    id: row.id,
    personaId: row.customer_id,
    type: row.intent_type,
    title: row.title,
    status: row.status,
    amount: Number(row.amount),
    fee: Number(row.fee),
    sourceAccountId: row.source_account_id,
    sourceAccountLabel: row.source_account_label,
    destinationAccountId: row.destination_account_id,
    destinationLabel: row.destination_label,
    fields: JSON.parse(row.fields_json) as ActionIntent["fields"],
    evidence: JSON.parse(row.evidence_json) as Evidence[],
    createdAt: row.created_at.toISOString(),
    sourceEventId: row.source_event_id,
    receipt: row.receipt,
  };
}

async function executeSqlSalaryAllocation(
  transaction: sql.Transaction,
  personaId: string,
  sessionId: string,
  intent: IntentRow,
  currency: Transaction["currency"],
) {
  const fields = JSON.parse(intent.fields_json) as ActionIntent["fields"];
  const movements = [
    {
      type: "bills",
      amount: parseIntentFieldAmount(fields, "Bills pocket"),
    },
    {
      type: "savings",
      amount: parseIntentFieldAmount(fields, "Move to savings"),
    },
  ].filter((movement) => movement.amount > 0);
  const accounts = await new sql.Request(transaction)
    .input("personaId", sql.NVarChar(40), personaId)
    .input("sourceAccountId", sql.NVarChar(64), intent.source_account_id)
    .input("currency", sql.NVarChar(3), currency)
    .query<{ id: string; name: string; type: string }>(`
      SELECT a.id, a.display_name AS name, a.account_type AS type
      FROM accounts a WITH (UPDLOCK, ROWLOCK)
      INNER JOIN account_holders ah ON ah.account_id = a.id
      WHERE ah.customer_id = @personaId
        AND a.id <> @sourceAccountId
        AND a.currency = @currency
      ORDER BY a.is_primary DESC, a.display_name;
    `);
  const savingsAccount = accounts.recordset.find(
    (account) => account.type === "savings",
  );
  const billsAccount = accounts.recordset.find(
    (account) => account.type !== "savings",
  );
  if (!savingsAccount || !billsAccount) {
    throw new Error(
      "This customer needs both a savings account and a bills account for salary allocation.",
    );
  }

  for (const movement of movements) {
    const destination =
      movement.type === "savings" ? savingsAccount : billsAccount;
    const sourceTransactionId = crypto.randomUUID();
    const destinationTransactionId = crypto.randomUUID();
    const postingId = crypto.randomUUID();
    const label =
      movement.type === "savings" ? "Savings allocation" : "Bills allocation";

    await new sql.Request(transaction)
      .input("sourceTransactionId", sql.NVarChar(64), sourceTransactionId)
      .input(
        "destinationTransactionId",
        sql.NVarChar(64),
        destinationTransactionId,
      )
      .input("sourceAccountId", sql.NVarChar(64), intent.source_account_id)
      .input("destinationAccountId", sql.NVarChar(64), destination.id)
      .input("sourceLabel", sql.NVarChar(160), intent.source_account_label)
      .input("destinationLabel", sql.NVarChar(160), destination.name)
      .input("amount", sql.Decimal(18, 2), movement.amount)
      .input("currency", sql.NVarChar(3), currency)
      .input("note", sql.NVarChar(240), label)
      .input("sessionId", sql.UniqueIdentifier, sessionId)
      .query(`
        INSERT INTO customer_transactions (
          id, account_id, merchant, category, amount, currency,
          direction, note, booked_at, demo_session_id
        ) VALUES
          (@sourceTransactionId, @sourceAccountId, @destinationLabel,
           'Transfer', @amount, @currency, 'debit', @note,
           SYSUTCDATETIME(), @sessionId),
          (@destinationTransactionId, @destinationAccountId, @sourceLabel,
           'Transfer', @amount, @currency, 'credit', @note,
           SYSUTCDATETIME(), @sessionId);
      `);

    await new sql.Request(transaction)
      .input("postingId", sql.UniqueIdentifier, postingId)
      .input("sourceTransactionId", sql.NVarChar(64), sourceTransactionId)
      .input("sourceAccountId", sql.NVarChar(64), intent.source_account_id)
      .input("destinationAccountId", sql.NVarChar(64), destination.id)
      .input("amount", sql.Decimal(18, 2), movement.amount)
      .query(`
        INSERT INTO ledger_postings (id, customer_transaction_id, posted_at)
        VALUES (@postingId, @sourceTransactionId, SYSUTCDATETIME());

        INSERT INTO ledger_entries (
          posting_id, ledger_account_id, debit, credit
        ) VALUES
          (@postingId, CONCAT('CUSTOMER-LIABILITY:', @sourceAccountId), @amount, 0),
          (@postingId, CONCAT('CUSTOMER-LIABILITY:', @destinationAccountId), 0, @amount);
      `);
  }
}

function parseIntentFieldAmount(
  fields: ActionIntent["fields"],
  label: string,
) {
  const value = fields.find((field) => field.label === label)?.value;
  if (!value) return 0;
  let normalized = value.replace(/[^\d,.-]/g, "");
  if (normalized.includes(",") && normalized.includes(".")) {
    const decimalSeparator =
      normalized.lastIndexOf(",") > normalized.lastIndexOf(".") ? "," : ".";
    normalized =
      decimalSeparator === ","
        ? normalized.replaceAll(".", "").replace(",", ".")
        : normalized.replaceAll(",", "");
  } else if (normalized.includes(",")) {
    normalized = /,\d{2}$/.test(normalized)
      ? normalized.replace(",", ".")
      : normalized.replaceAll(",", "");
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label.toLocaleLowerCase()} amount.`);
  }
  return Math.round(parsed * 100) / 100;
}

function mapTransaction(row: {
  id: string;
  accountId: string;
  merchant: string;
  category: string;
  amount: number;
  currency: Transaction["currency"];
  bookedAt: Date;
  direction: "credit" | "debit";
  note: string;
}): Transaction {
  return {
    ...row,
    amount: Number(row.amount),
    bookedAt: row.bookedAt.toISOString(),
  };
}
