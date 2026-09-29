import { DefaultAzureCredential } from "@azure/identity";
import sql from "mssql";

async function main() {
  const credential = new DefaultAzureCredential();
  const token = await credential.getToken(
    "https://database.windows.net//.default",
  );
  if (!token) throw new Error("Could not acquire an Azure SQL token.");
  const pool = await new sql.ConnectionPool({
    server: required("SQL_SERVER"),
    database: required("SQL_DATABASE"),
    authentication: {
      type: "azure-active-directory-access-token",
      options: { token: token.token },
    },
    options: { encrypt: true, trustServerCertificate: false },
  }).connect();
  try {
    const result = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM customers) AS customers,
        (SELECT COUNT(*) FROM action_intents) AS intents,
        (SELECT COUNT(*) FROM action_intents
          WHERE intent_type = 'salary_allocation') AS salaryIntents,
        (SELECT COUNT(*) FROM action_intents
          WHERE status = 'awaiting_approval') AS pendingIntents,
        (SELECT COUNT(*) FROM automation_rules
          WHERE event_type = 'salary_posted'
            AND status = 'approved') AS activeSalaryRules,
        (SELECT COUNT(*) FROM execution_idempotency) AS executions,
        (SELECT COUNT(*) FROM (
          SELECT posting_id
          FROM ledger_entries
          GROUP BY posting_id
          HAVING SUM(debit) <> SUM(credit)
        ) unbalanced) AS unbalancedPostings,
        (SELECT COUNT(*) FROM sys.database_principals
          WHERE type = 'E') AS externalIdentities;
    `);
    console.log(JSON.stringify(result.recordset[0]));
  } finally {
    await pool.close();
  }
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
