# Caldova Banking

Caldova is a synthetic, mobile-first banking experience. A Microsoft Foundry
model reasons over a customer's request and selects typed tools. The Next.js
application validates each tool call and scopes it to the selected synthetic
customer; the model has no direct SQL connection or authority to execute a
payment. Azure SQL holds accounts, transactions, proposals and ledger postings.
Azure AI Search retrieves reference guides from `knowledge/`. Service Bus
wakes a worker for salary events. Invoice extraction uses Document Intelligence;
voice input uses Azure speech transcription.

Open-ended requests create a customer-visible Agent Plan. Tool results and
evidence appear in the mobile experience; **See the data behind this answer**
shows checked banking facts and retrieved passages, including full guides.
Money movement and advisor messages require review and explicit approval.
Application code validates constraints and calculates amounts; settlement is
idempotent. The profiles, accounts, transactions, guides and ledger are sample
data, not a production bank integration.

## Source of the agent's instructions

The **verbatim primary system prompt** is the `systemPrompt` constant in
[`src/web/lib/agent.ts`](src/web/lib/agent.ts), passed as `instructions` in
each Foundry Responses request. The same file defines the model's typed tool
catalog and the application-side `executeTool` dispatcher. Existing plan
context, capability-boundary rechecks, and unfinished-plan reminders are
*runtime user messages*, not separate system prompts. The event worker has
deterministic logic, not a second model prompt. No separate MCP server sits
between Foundry and SQL.

## Run locally

Use Node.js 20+ and `npm ci` at the project root. `npm run dev` starts the
Next.js web app; `npm test`, `npm run lint` and `npm run build` run the checks.
Without `FOUNDRY_PROJECT_ENDPOINT`, the assistant explicitly reports model
unavailability rather than simulating agent behavior. Without Azure SQL
configuration, the app uses in-memory synthetic fixtures, which reset with
the process. A fully functional agent needs identity-based access to the
Foundry project, AI Search, embedding model and (for durable state) Azure SQL.
See the environment variables in `infra/resources.bicep` for the deployed
service configuration; do not place credentials in source.

`DEMO_ACCESS_KEY_HASH` is the SHA-256 hex digest of the trimmed, lowercased
demo key (`normalizeDemoKey` in `src/web/lib/demo-access.ts`). Set it only
in your local environment or secure Azure configuration. The access screen
is a shared demo gate, **not** end-user authentication or authorization.
Persona selection is for synthetic demo records only.

## Deploy to your own Azure environment

`azure.yaml`, `infra/` and the two Dockerfiles define an `azd` deployment:
Container Apps for web and worker, Foundry, Search, SQL, Service Bus, Blob
Storage and monitoring. Provision a **new** AZD environment with your own
subscription, region, Azure identity and demo-key hash, then use `azd up`.
The post-provision hook runs `npm run db:migrate` and
`npm run knowledge:index`; both require appropriate Azure permissions.
Changes to the web app can be deployed with `azd deploy web` in that
environment. Do not re-provision an existing environment from another
branding or infrastructure revision: resource names in `infra/` are part of
the deployment identity. The hosted demonstration has separate access
credentials, provided by its owner outside this repository.

## Repository hygiene

The root `.gitignore` excludes AZD state (including local secrets), dependency
and build trees, browser traces, generated infrastructure JSON, and the
original static design prototype/screenshots. `styles.css` at the root is
**live application CSS** imported by `src/web/app/globals.css` and must remain.
Only synthetic data belongs in this repository. Review `git status` and
`git ls-files` before publishing any changes.

The five-slide Reveal.js architecture deck and presenter notes are in
`presentation/architecture.html`; open it in a browser and press **S** for
speaker view. Live demo URLs and access keys are intentionally not embedded.
