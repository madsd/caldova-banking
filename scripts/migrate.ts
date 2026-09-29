import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DefaultAzureCredential } from "@azure/identity";
import sql from "mssql";

async function connect() {
  const server = required("SQL_SERVER");
  const database = required("SQL_DATABASE");
  const credential = new DefaultAzureCredential();
  const token = await credential.getToken(
    "https://database.windows.net//.default",
  );
  if (!token) {
    throw new Error("Could not acquire an Azure SQL access token.");
  }
  return new sql.ConnectionPool({
    server,
    database,
    authentication: {
      type: "azure-active-directory-access-token",
      options: { token: token.token },
    },
    options: { encrypt: true, trustServerCertificate: false },
  }).connect();
}

async function main() {
  const pool = await connect();
  try {
    const schema = await readFile(
      resolve(process.cwd(), "scripts", "schema.sql"),
      "utf8",
    );
    const batches = schema
      .split(/^\s*GO\s*$/gim)
      .map((batch) => batch.trim())
      .filter(Boolean);
    for (const batch of batches) {
      await pool.request().batch(batch);
    }

    const identities = [
      {
        name: process.env.WEB_IDENTITY_NAME,
        principalId: process.env.WEB_IDENTITY_PRINCIPAL_ID,
      },
      {
        name: process.env.WORKER_IDENTITY_NAME,
        principalId: process.env.WORKER_IDENTITY_PRINCIPAL_ID,
      },
    ];
    for (const { name: identityName, principalId } of identities) {
      if (!identityName || !principalId) continue;
      const escapedName = identityName.replaceAll("]", "]]");
      const escapedObjectId = principalId.replaceAll("'", "''");
      await pool.request().batch(`
        IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '${escapedName}')
        BEGIN
          CREATE USER [${escapedName}]
            FROM EXTERNAL PROVIDER WITH OBJECT_ID='${escapedObjectId}';
          ALTER ROLE db_datareader ADD MEMBER [${escapedName}];
          ALTER ROLE db_datawriter ADD MEMBER [${escapedName}];
        END;
      `);
    }
  } finally {
    await pool.close();
  }
  console.log("Azure SQL schema and synthetic personas are ready.");
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
