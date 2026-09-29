import { AIProjectClient } from "@azure/ai-projects";
import {
  DefaultAzureCredential,
  getBearerTokenProvider,
} from "@azure/identity";
import { SearchClient } from "@azure/search-documents";
import { AzureOpenAI } from "openai";
import { z } from "zod";
import type { FunctionTool } from "openai/resources/responses/responses";
import {
  compareCashScenarios,
  getAgentPlan,
  getDashboard,
  getLastMobileTopup,
  getMoneyRadar,
  getSavingsProjection,
  getResiliencePlan,
  getScamGuardian,
  getSpendingSummary,
  getSubscriptionReview,
  localPolicyEvidence,
  prepareAdvisorMessage,
  prepareMoneyMovement,
  prepareSalaryAllocation,
  searchTransactions,
  saveAgentPlan,
} from "@/lib/store";
import { listBankingCapabilities } from "@/lib/banking-capabilities";
import {
  addPlanEvidence,
  addPlanScenarios,
  applyAgentPlanUpdate,
  reconcileAgentPlan,
  updatePlanStep,
} from "@/lib/agent-plan";
import type { SalaryAllocationPreferences } from "@/lib/store";
import type {
  AgentEvent,
  AgentPlan,
  ChatTurn,
  Evidence,
  FinancialInsight,
  SpendingSummary,
  Transaction,
} from "@/lib/types";

type Emit = (event: AgentEvent) => void | Promise<void>;

const accountTool: FunctionTool = {
  type: "function",
  name: "get_account_snapshot",
  description:
    "Get the selected customer's account balance, masked account, phone, and recent transactions.",
  strict: true,
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

const lastTopupTool: FunctionTool = {
  type: "function",
  name: "get_last_mobile_topup",
  description:
    "Find the customer's most recent mobile top-up, including amount, operator, and phone.",
  strict: true,
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

const transactionTool: FunctionTool = {
  type: "function",
  name: "search_transactions",
  description:
    "Search the selected customer's transactions by merchant, category, or note.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Merchant, category, or transaction phrase to search for.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

const knowledgeTool: FunctionTool = {
  type: "function",
  name: "search_products_and_policies",
  description:
    "Search Caldova product, policy, fee, and help content. Use this before making claims about limits, fees, eligibility, or products.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The product or policy question to retrieve evidence for.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

const capabilityTool: FunctionTool = {
  type: "function",
  name: "list_banking_capabilities",
  description:
    "List the common and advanced banking outcomes this environment can currently support, including whether they are read-only, analytical, approval-backed, automated, or escalated to a human. Use this for broad requests or when deciding how several capabilities can be composed.",
  strict: true,
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

const prepareMoneyMovementTool: FunctionTool = {
  type: "function",
  name: "prepare_money_movement",
  description:
    "Prepare, but never execute, a governed money movement for explicit customer approval. Supports transfers between the customer's own accounts, mobile top-ups, and bill payments. Use get_account_snapshot to resolve the exact source account and any destination account.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["own_account_transfer", "mobile_topup", "bill_payment"],
        description: "The banking rail required by the customer's request.",
      },
      sourceAccountId: {
        type: "string",
        description: "Exact source account ID from get_account_snapshot.",
      },
      destinationAccountId: {
        type: ["string", "null"],
        description:
          "Exact destination account ID for an own-account transfer; otherwise null.",
      },
      amount: {
        type: "number",
        description: "Positive amount requested by the customer.",
      },
      destinationLabel: {
        type: ["string", "null"],
        description:
          "Verified phone for a mobile top-up or payee for a bill payment; null for an own-account transfer.",
      },
      reference: {
        type: ["string", "null"],
        description: "Optional bill reference; null when unavailable.",
      },
      dueDate: {
        type: ["string", "null"],
        description: "Optional bill due date; null when unavailable.",
      },
      provenance: {
        type: "string",
        enum: ["customer_instruction", "history_match", "invoice_upload"],
        description:
          "How the destination and amount were obtained. Use history_match only after retrieving the previous top-up, and invoice_upload only for extracted invoice data.",
      },
    },
    required: [
      "kind",
      "sourceAccountId",
      "destinationAccountId",
      "amount",
      "destinationLabel",
      "reference",
      "dueDate",
      "provenance",
    ],
    additionalProperties: false,
  },
};

const prepareSalaryTool: FunctionTool = {
  type: "function",
  name: "prepare_salary_allocation",
  description:
    "Prepare a salary allocation proposal that applies the customer's requested savings amount or percentage, bills amount or percentage, and minimum available reserve. Use null for omitted instructions. Never activate or transfer without approval.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      salary: {
        type: ["number", "null"],
        description:
          "Customer-provided salary in UAH, or null when the request omits an amount. Never guess or send zero.",
      },
      savingsAmount: {
        type: ["number", "null"],
        description:
          "Exact UAH amount requested for savings, or null. Do not set this together with savingsPercent.",
      },
      savingsPercent: {
        type: ["number", "null"],
        description:
          "Percentage of salary requested for savings, or null. Do not set this together with savingsAmount.",
      },
      billsAmount: {
        type: ["number", "null"],
        description:
          "Exact UAH amount requested for the bills pocket, or null. Do not set this together with billsPercent.",
      },
      billsPercent: {
        type: ["number", "null"],
        description:
          "Percentage of salary requested for the bills pocket, or null. Do not set this together with billsAmount.",
      },
      minimumAvailable: {
        type: ["number", "null"],
        description:
          "Minimum UAH amount the customer explicitly wants left available, or null for the bank default.",
      },
    },
    required: [
      "salary",
      "savingsAmount",
      "savingsPercent",
      "billsAmount",
      "billsPercent",
      "minimumAvailable",
    ],
    additionalProperties: false,
  },
};

const spendingSummaryTool: FunctionTool = {
  type: "function",
  name: "get_spending_summary",
  description:
    "Analyze six completed months of verified income, external spending, surplus, and spending categories. Use this before recommending a monthly savings amount.",
  strict: true,
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

const savingsProjectionTool: FunctionTool = {
  type: "function",
  name: "simulate_savings_projection",
  description:
    "Project visible savings using a customer-specified monthly saving amount and horizon. The deterministic tool caps the amount at the history-based safe level and assumes no returns.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      monthlySavingAmount: {
        type: "number",
        description: "Monthly saving amount in UAH specified by the customer.",
      },
      months: {
        type: "integer",
        description: "Projection horizon from 1 to 24 months.",
      },
    },
    required: ["monthlySavingAmount", "months"],
    additionalProperties: false,
  },
};

const cashScenarioTool: FunctionTool = {
  type: "function",
  name: "compare_cash_scenarios",
  description:
    "Compare a customer-stated cash target and deadline with visible savings, a customer-stated protected reserve, and deterministic capacity from transaction history. Call get_account_snapshot and get_spending_summary first. Never infer the target, deadline, or reserve.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      goalName: {
        type: "string",
        description: "Customer's name for the outcome or life event.",
      },
      targetAmount: {
        type: "number",
        description: "Customer-provided cash target in UAH.",
      },
      months: {
        type: "integer",
        description: "Customer-provided deadline from 1 to 60 months.",
      },
      protectedReserve: {
        type: "number",
        description:
          "Customer-provided UAH reserve that must remain untouched. Ask when missing.",
      },
    },
    required: ["goalName", "targetAmount", "months", "protectedReserve"],
    additionalProperties: false,
  },
};

const moneyRadarTool: FunctionTool = {
  type: "function",
  name: "get_money_radar",
  description:
    "Detect visible spending changes and forecast repeated obligations using completed-month transactions.",
  strict: true,
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

const scamGuardianTool: FunctionTool = {
  type: "function",
  name: "investigate_suspicious_payment",
  description:
    "Inspect a matching visible transaction for transparent warning signals. This never declares fraud and does not block a card.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Merchant or transaction wording from visible history.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

const subscriptionTool: FunctionTool = {
  type: "function",
  name: "review_subscriptions",
  description:
    "Find subscription merchants repeated in at least three distinct months and explain price changes.",
  strict: true,
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

const resilienceTool: FunctionTool = {
  type: "function",
  name: "get_resilience_plan",
  description:
    "Calculate transparent cash runway from visible UAH liquidity and observed essential spending.",
  strict: true,
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

const advisorMessageTool: FunctionTool = {
  type: "function",
  name: "prepare_advisor_message",
  description:
    "Prepare a draft message to the customer's named bank advisor. Use only when the customer explicitly asks to inform or contact their advisor. The customer must review and approve the draft before it is sent.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        enum: [
          "Payments and transfers",
          "Cards and security",
          "Accounts and savings",
          "Fees and services",
          "Something else",
        ],
        description: "The advisor inbox topic selected for the draft.",
      },
      message: {
        type: "string",
        description:
          "A concise customer-voiced draft. State only the customer's request and facts already returned by tools in this conversation.",
      },
    },
    required: ["topic", "message"],
    additionalProperties: false,
  },
};

const DOMAIN_TOOL_NAMES = [
  "list_banking_capabilities",
  "get_account_snapshot",
  "get_last_mobile_topup",
  "search_transactions",
  "search_products_and_policies",
  "prepare_money_movement",
  "prepare_salary_allocation",
  "get_spending_summary",
  "simulate_savings_projection",
  "compare_cash_scenarios",
  "get_money_radar",
  "investigate_suspicious_payment",
  "review_subscriptions",
  "get_resilience_plan",
  "prepare_advisor_message",
] as const;

const agentPlanTool: FunctionTool = {
  type: "function",
  name: "update_agent_plan",
  description:
    "Create or revise the visible plan for an open-ended, multi-step customer request. The plan is authored by the model from the conversation and available tool descriptions; there are no predefined mission types or step templates. Constraints must be exact quotes from customer messages.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["create", "update"],
        description:
          "Create a new plan for a materially new objective, or update the current plan for a follow-up.",
      },
      objective: {
        type: "string",
        maxLength: 240,
        description: "A concise description of the customer's requested outcome.",
      },
      status: {
        type: "string",
        enum: ["active", "needs_input", "ready_for_decision", "completed"],
        description:
          "Current plan status. Use ready_for_decision only after the necessary grounded evidence or approval proposal exists.",
      },
      constraints: {
        type: "array",
        items: { type: "string", maxLength: 500 },
        description:
          "Exact customer-authored constraint quotes. Do not paraphrase or add constraints.",
      },
      openQuestions: {
        type: "array",
        items: { type: "string", maxLength: 240 },
        description: "Questions that require customer input before proceeding.",
      },
      steps: {
        type: "array",
        description:
          "A short model-authored plan. Bind a step to a tool only when that tool is relevant; use null for clarification, explanation, or human review.",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              maxLength: 48,
              pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
              description: "Stable short identifier unique within this plan.",
            },
            title: {
              type: "string",
              maxLength: 160,
              description: "Customer-readable action summary.",
            },
            toolName: {
              type: ["string", "null"],
              enum: [...DOMAIN_TOOL_NAMES, null],
              description:
                "Exact domain tool name that performs this step, or null when no tool is needed.",
            },
            status: {
              type: "string",
              enum: [
                "pending",
                "running",
                "completed",
                "blocked",
                "skipped",
              ],
            },
          },
          required: ["id", "title", "toolName", "status"],
          additionalProperties: false,
        },
      },
    },
    required: [
      "operation",
      "objective",
      "status",
      "constraints",
      "openQuestions",
      "steps",
    ],
    additionalProperties: false,
  },
};

const tools: FunctionTool[] = [
  agentPlanTool,
  capabilityTool,
  accountTool,
  lastTopupTool,
  transactionTool,
  knowledgeTool,
  prepareMoneyMovementTool,
  prepareSalaryTool,
  spendingSummaryTool,
  savingsProjectionTool,
  cashScenarioTool,
  moneyRadarTool,
  scamGuardianTool,
  subscriptionTool,
  resilienceTool,
  advisorMessageTool,
];

const toolArgs = {
  search_transactions: z.object({ query: z.string().min(1) }),
  search_products_and_policies: z.object({ query: z.string().min(1) }),
  prepare_money_movement: z.object({
    kind: z.enum([
      "own_account_transfer",
      "mobile_topup",
      "bill_payment",
    ]),
    sourceAccountId: z.string().min(1).max(64),
    destinationAccountId: z.string().min(1).max(64).nullable(),
    amount: z.number().positive().max(10_000_000),
    destinationLabel: z.string().trim().min(1).max(200).nullable(),
    reference: z.string().trim().min(1).max(160).nullable(),
    dueDate: z.string().trim().min(1).max(80).nullable(),
    provenance: z.enum([
      "customer_instruction",
      "history_match",
      "invoice_upload",
    ]),
  }),
  prepare_salary_allocation: z.object({
    salary: z.number().min(0).max(1_000_000).nullable(),
    savingsAmount: z.number().min(0).max(1_000_000).nullable(),
    savingsPercent: z.number().min(0).max(100).nullable(),
    billsAmount: z.number().min(0).max(1_000_000).nullable(),
    billsPercent: z.number().min(0).max(100).nullable(),
    minimumAvailable: z.number().min(0).max(1_000_000).nullable(),
  }),
  simulate_savings_projection: z.object({
    monthlySavingAmount: z.number().positive().max(1_000_000),
    months: z.number().int().min(1).max(24),
  }),
  compare_cash_scenarios: z.object({
    goalName: z.string().trim().min(1).max(120),
    targetAmount: z.number().positive().max(10_000_000),
    months: z.number().int().min(1).max(60),
    protectedReserve: z.number().min(0).max(10_000_000),
  }),
  investigate_suspicious_payment: z.object({
    query: z.string().trim().min(1).max(160),
  }),
  prepare_advisor_message: z.object({
    topic: z.enum([
      "Payments and transfers",
      "Cards and security",
      "Accounts and savings",
      "Fees and services",
      "Something else",
    ]),
    message: z.string().trim().min(3).max(1200),
  }),
  update_agent_plan: z.object({
    operation: z.enum(["create", "update"]),
    objective: z.string().trim().min(1).max(240),
    status: z.enum([
      "active",
      "needs_input",
      "ready_for_decision",
      "completed",
    ]),
    constraints: z.array(z.string().trim().min(1).max(500)).max(8),
    openQuestions: z.array(z.string().trim().min(1).max(240)).max(6),
    steps: z
      .array(
        z.object({
          id: z
            .string()
            .trim()
            .min(1)
            .max(48)
            .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
          title: z.string().trim().min(1).max(160),
          toolName: z.enum(DOMAIN_TOOL_NAMES).nullable(),
          status: z.enum([
            "pending",
            "running",
            "completed",
            "blocked",
            "skipped",
          ]),
        }),
      )
      .min(1)
      .max(10),
  }),
};

const systemPrompt = `You are the Caldova Bank customer outcome-planning agent.
You help with synthetic retail banking data only. You may answer account and
transaction questions, explain spending, search bank products and policies, and
prepare bounded banking actions.

Rules:
- Decide how to help from the conversation, the current Agent Plan when present,
  and the available tool descriptions. There are no predefined missions, routes,
  or tool sequences.
- When a current Agent Plan is present, align it with the latest customer
  message before using any domain tool. Revise it for a follow-up, or replace it
  for a materially new objective. Never carry constraints from an unrelated
  objective into the current request.
- For an open-ended request that needs multiple steps, first call
  update_agent_plan with a concise customer-visible plan that you authored. Choose
  only the tools needed for this request. Do not expose private chain-of-thought.
- Update the plan as evidence arrives. Before a bound tool runs, mark its step
  running; after its result, mark that step completed. Use needs_input when a
  required customer value is missing, and ready_for_decision only when the
  necessary evidence or approval proposal is present and every tool-bound step
  is completed or explicitly skipped.
- Plan constraints must be exact quotes from customer messages. Never turn your
  own response, an assumption, or a tool result into a customer constraint.
- Use tools for every customer-specific fact. Never invent balances, recipients,
  transactions, fees, limits, products, or policy.
- Before a product, fee, eligibility, or policy claim, call
  search_products_and_policies and cite the returned sources naturally.
- You can prepare actions, but you cannot execute them. Tell the customer that
  review and explicit approval are required.
- For broad or unfamiliar requests, call list_banking_capabilities and compose
  the relevant capabilities instead of forcing the request into a predefined
  conversational route.
- Prepare transfers, top-ups, and bill payments through prepare_money_movement.
  Call get_account_snapshot to resolve the exact source account and any own-account
  destination. Do not ask the customer to repeat an account name that already
  identifies one visible account unambiguously.
- A request to transfer or move money between the customer's visible accounts is
  supported as an approval-backed preparation. Never refuse it merely because
  you cannot execute it directly: retrieve the accounts, prepare the movement,
  and explain that execution waits for the customer's explicit approval.
- For "same as last time", retrieve the previous action before preparing.
- For salary planning without an explicit amount, pass null to
  prepare_salary_allocation. The tool will use a verified recent salary credit
  when available; never invent an amount or pass zero as a guess.
- Preserve every explicit salary-allocation instruction in the corresponding
  amount, percentage, or minimum-available argument. Pass null for instructions
  the customer did not provide; never replace their values with generic ratios.
- If a tool says customer input is required, ask one concise clarifying question.
- Before recommending how much the customer can save monthly, call
  get_spending_summary and explain the recommendation from its verified averages.
- Financial projections and alerts must come from the dedicated deterministic tool.
  State its evidence window, assumptions, and methodology. Never calculate or invent
  financial figures yourself.
- Savings projection requires an explicit customer amount and horizon. Scenario
  comparison also requires an explicit target, deadline, and protected reserve.
  Ask one focused question for the next missing value instead of guessing.
- Scam Guardian reports observable signals, never a fraud verdict. Card blocking is
  outside this tool.
- If the customer explicitly asks to inform or contact their advisor, gather any
  necessary evidence with the relevant tools first, then call
  prepare_advisor_message. It creates a draft only. The customer must approve
  the exact topic and text before it appears as sent in advisor messages.
- Do not provide investment advice or perform lending decisions.
- Keep responses short and clear for a mobile interface.
- If a request is outside available tools, explain the boundary without
  pretending it succeeded.`;

export async function runBankingAgent(
  personaId: string,
  message: string,
  emit: Emit,
  sessionId = "local-default",
  history: ChatTurn[] = [],
) {
  let plan = await getAgentPlan(personaId, sessionId);

  if (!process.env.FOUNDRY_PROJECT_ENDPOINT) {
    await emit({
      type: "status",
      title: "Foundry model unavailable",
      detail:
        "Open-ended banking guidance is not replaced with local keyword routing.",
    });
    await emit({
      type: "message",
      text: "The Foundry model is required for assistant planning in this environment. Customer data and deterministic banking tools remain available, but the app will not imitate the agent with hardcoded request matching.",
    });
    await emit({ type: "done", mode: "local-preview" });
    return;
  }

  await emit({
    type: "status",
    title: "Understanding your request",
    detail: "The Foundry model is selecting the banking evidence it needs.",
  });

  const project = new AIProjectClient(
    process.env.FOUNDRY_PROJECT_ENDPOINT,
    new DefaultAzureCredential(),
  );
  const openai = project.getOpenAIClient();
  const model = process.env.FOUNDRY_MODEL ?? "gpt-5.4-mini";
  let groundedSources: Evidence[] = [];
  let capabilityBoundaryChecked = false;

  const input = history.map((turn) => ({
    type: "message" as const,
    role: turn.role,
    content: turn.content,
  }));
  input.push({
    type: "message" as const,
    role: "user",
    content: plan
      ? `${message}\n\nExisting Agent Plan context (reuse only when this message is a follow-up; otherwise replace it before using domain tools. Never carry constraints into an unrelated objective, and never fill unknown numbers yourself):\n${JSON.stringify(plan)}`
      : message,
  });
  const customerMessages = [
    ...history
      .filter((turn) => turn.role === "user")
      .map((turn) => turn.content),
    message,
  ];

  let response = await openai.responses.create({
    model,
    instructions: systemPrompt,
    input,
    tools,
  });
  let planAlignedThisTurn = plan === null;

  for (let round = 0; round < 10; round += 1) {
    const calls = response.output.filter(
      (item) => item.type === "function_call",
    );
    if (calls.length === 0) {
      const modelText =
        response.output_text ||
        "I could not complete that request with the available banking tools.";
      if (
        !capabilityBoundaryChecked &&
        shouldRecheckCapabilityBoundary(modelText) &&
        round < 9
      ) {
        capabilityBoundaryChecked = true;
        response = await openai.responses.create({
          model,
          instructions: systemPrompt,
          previous_response_id: response.id,
          input: [
            {
              type: "message",
              role: "user",
              content: `Before presenting a capability boundary, verify it against this bank-controlled registry:\n${JSON.stringify(
                listBankingCapabilities().map(
                  ({
                    name,
                    mode,
                    description,
                    approvalRequired,
                    examples,
                  }) => ({
                    name,
                    mode,
                    description,
                    approvalRequired,
                    examples,
                  }),
                ),
              )}\nIf the customer's request matches a supported capability, continue now with the necessary tools instead of refusing. A prepare capability creates an approval proposal; it does not execute without customer confirmation. If the request is genuinely unsupported, keep the boundary concise. Do not mention this internal verification step.`,
            },
          ],
          tools,
        });
        continue;
      }
      if (plan && planAlignedThisTurn) {
        const reconciledPlan = reconcileAgentPlan(plan);
        if (reconciledPlan !== plan) {
          plan = reconciledPlan;
          await saveAgentPlan(personaId, plan, sessionId);
          await emit({ type: "plan", plan });
        }
        const pendingToolSteps = plan.steps.filter(
          (step) =>
            step.toolName !== null &&
            (step.status === "pending" || step.status === "running"),
        );
        if (
          plan.status === "active" &&
          pendingToolSteps.length > 0 &&
          round < 9
        ) {
          response = await openai.responses.create({
            model,
            instructions: systemPrompt,
            previous_response_id: response.id,
            input: [
              {
                type: "message",
                role: "user",
                content: `The visible plan still has unresolved tool steps: ${pendingToolSteps
                  .map((step) => `${step.title} (${step.toolName})`)
                  .join(", ")}. Continue with the tools you consider necessary, or update_agent_plan to mark a step skipped if it is no longer relevant. Do not present a final decision while required plan work remains pending.`,
              },
            ],
            tools,
          });
          continue;
        }
      }
      await emit({
        type: "message",
        text: modelText,
        sources: groundedSources,
      });
      await emit({ type: "done", mode: "foundry" });
      return;
    }

    const includesPlanUpdate = calls.some(
      (call) => call.name === "update_agent_plan",
    );
    if (plan && !planAlignedThisTurn && !includesPlanUpdate && round < 9) {
      response = await openai.responses.create({
        model,
        instructions: systemPrompt,
        previous_response_id: response.id,
        input: [
          ...calls.map(
            (call) => ({
              type: "function_call_output" as const,
              call_id: call.call_id,
              output: JSON.stringify({
                error:
                  "Align the existing Agent Plan with the latest customer message before using domain tools.",
              }),
            }),
          ),
          {
            type: "message",
            role: "user",
            content:
              "Call update_agent_plan now. Revise the plan if this is a follow-up, or replace it if the customer started a materially new objective. Then continue with only the tools needed for the current request.",
          },
        ],
        tools,
      });
      continue;
    }

    const outputs: Array<{
      type: "function_call_output";
      call_id: string;
      output: string;
    }> = [];
    const orderedCalls = [...calls].sort((left, right) => {
      if (left.name === "update_agent_plan") return -1;
      if (right.name === "update_agent_plan") return 1;
      if (left.name === "prepare_advisor_message") return 1;
      if (right.name === "prepare_advisor_message") return -1;
      return 0;
    });
    for (const call of orderedCalls) {
      if (call.name === "update_agent_plan") {
        const args = toolArgs.update_agent_plan.parse(
          JSON.parse(call.arguments),
        );
        plan = applyAgentPlanUpdate(plan, args, customerMessages);
        planAlignedThisTurn = true;
        await saveAgentPlan(personaId, plan, sessionId);
        await emit({ type: "plan", plan });
        outputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify({
            planId: plan.id,
            status: plan.status,
            acceptedConstraints: plan.constraints,
            message: "The customer-visible Agent Plan was saved.",
          }),
        });
        continue;
      }

      const planStepId = findPlanStepId(plan, call.name);
      if (plan && planStepId) {
        plan = updatePlanStep(plan, planStepId, "running");
        await saveAgentPlan(personaId, plan, sessionId);
        await emit({ type: "plan", plan });
      }
      const result = await executeTool(
        personaId,
        call.name,
        call.arguments,
        emit,
        sessionId,
        plan?.evidence ?? [],
      );
      if (plan) {
        plan = updatePlanStep(
          plan,
          planStepId,
          requiresCustomerInput(result) ? "blocked" : "completed",
        );
        plan = addPlanEvidence(plan, extractToolEvidence(call.name, result));
        if (isFinancialInsight(result) && result.scenarios) {
          plan = addPlanScenarios(plan, result.scenarios);
        }
        if (hasApprovalIntent(result)) {
          plan = {
            ...plan,
            proposedActions: [
              ...plan.proposedActions.filter(
                (action) => action.id !== result.intentId,
              ),
              {
                id: result.intentId,
                title: describeProposedAction(call.name),
                status: "awaiting_approval",
              },
            ],
            updatedAt: new Date().toISOString(),
          };
        }
        await saveAgentPlan(personaId, plan, sessionId);
        await emit({ type: "plan", plan });
      }
      const currentEvidence =
        call.name === "search_products_and_policies" && Array.isArray(result)
          ? result.filter(isEvidence)
          : extractToolEvidence(call.name, result);
      groundedSources = [
        ...new Map(
          [...groundedSources, ...currentEvidence].map((source) => [
            `${source.title}|${source.source ?? ""}`,
            source,
          ]),
        ).values(),
      ].slice(-12);
      outputs.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
    }

    response = await openai.responses.create({
      model,
      instructions: systemPrompt,
      previous_response_id: response.id,
      input: outputs,
      tools,
    });
  }

  await emit({
    type: "error",
    message:
      "The agent reached its orchestration limit before finishing. No pending action was executed.",
  });
  await emit({ type: "done", mode: "foundry" });
}

export function shouldRecheckCapabilityBoundary(text: string) {
  return /\b(?:can(?:not|['’]t)|unable|not able|do not have|don't have|outside (?:my|the) (?:tools|capabilities))\b/i.test(
    text,
  );
}

async function executeTool(
  personaId: string,
  name: string,
  rawArguments: string,
  emit: Emit,
  sessionId: string,
  planEvidence: Evidence[],
) {
  const id = crypto.randomUUID();
  await emit({
    type: "tool_start",
    id,
    name,
    detail: describeTool(name, "start"),
  });

  let result: unknown;
  if (name === "list_banking_capabilities") {
    result = listBankingCapabilities();
  } else if (name === "get_account_snapshot") {
    const dashboard = await getDashboard(personaId, sessionId);
    result = {
      ...dashboard,
      transactions: dashboard.transactions.slice(0, 10),
    };
  } else if (name === "get_last_mobile_topup") {
    result = await getLastMobileTopup(personaId, sessionId);
  } else if (name === "search_transactions") {
    const args = toolArgs.search_transactions.parse(JSON.parse(rawArguments));
    result = await searchTransactions(personaId, args.query, sessionId);
  } else if (name === "search_products_and_policies") {
    const args = toolArgs.search_products_and_policies.parse(
      JSON.parse(rawArguments),
    );
    result = await searchKnowledge(args.query);
  } else if (name === "prepare_money_movement") {
    const args = toolArgs.prepare_money_movement.parse(
      JSON.parse(rawArguments),
    );
    const intent =
      args.kind === "own_account_transfer"
        ? await prepareMoneyMovement(
            personaId,
            {
              kind: args.kind,
              sourceAccountId: args.sourceAccountId,
              destinationAccountId: requiredToolValue(
                args.destinationAccountId,
                "A destination account is required for an own-account transfer.",
              ),
              amount: args.amount,
            },
            sessionId,
          )
        : args.kind === "mobile_topup"
          ? await prepareMoneyMovement(
              personaId,
              {
                kind: args.kind,
                sourceAccountId: args.sourceAccountId,
                phone: requiredToolValue(
                  args.destinationLabel,
                  "A phone number is required for a mobile top-up.",
                ),
                amount: args.amount,
                provenance:
                  args.provenance === "history_match"
                    ? "history_match"
                    : "customer_instruction",
              },
              sessionId,
            )
          : await prepareMoneyMovement(
              personaId,
              {
                kind: args.kind,
                sourceAccountId: args.sourceAccountId,
                payee: requiredToolValue(
                  args.destinationLabel,
                  "A payee is required for a bill payment.",
                ),
                amount: args.amount,
                reference: args.reference ?? undefined,
                dueDate: args.dueDate ?? undefined,
                provenance:
                  args.provenance === "invoice_upload"
                    ? "invoice_upload"
                    : "customer_instruction",
              },
              sessionId,
            );
    await emit({ type: "intent", intent });
    result = {
      intentId: intent.id,
      status: intent.status,
      requiresApproval: true,
    };
  } else if (name === "prepare_salary_allocation") {
    const args = toolArgs.prepare_salary_allocation.parse(
      JSON.parse(rawArguments),
    );
    const dashboard = await getDashboard(personaId, sessionId);
    const salary = resolveSalaryAmount(args.salary, dashboard.transactions);
    if (salary === null) {
      result = {
        requiresCustomerInput: true,
        message:
          "No recent salary credit is available. Ask the customer for the expected salary amount.",
      };
    } else {
      const preferences: SalaryAllocationPreferences = {
        savingsAmount: args.savingsAmount,
        savingsPercent: args.savingsPercent,
        billsAmount: args.billsAmount,
        billsPercent: args.billsPercent,
        minimumAvailable: args.minimumAvailable,
      };
      const intent = await prepareSalaryAllocation(
        personaId,
        salary,
        sessionId,
        preferences,
      );
      await emit({ type: "intent", intent });
      result = {
        intentId: intent.id,
        salary,
        fields: intent.fields,
        status: intent.status,
        requiresApproval: true,
      };
    }
  } else if (name === "get_spending_summary") {
    result = await getSpendingSummary(personaId, sessionId);
  } else if (name === "simulate_savings_projection") {
    const args = toolArgs.simulate_savings_projection.parse(
      JSON.parse(rawArguments),
    );
    result = await getSavingsProjection(
      personaId,
      args.monthlySavingAmount,
      args.months,
      sessionId,
    );
  } else if (name === "compare_cash_scenarios") {
    const args = toolArgs.compare_cash_scenarios.parse(
      JSON.parse(rawArguments),
    );
    result = await compareCashScenarios(
      personaId,
      args.goalName,
      args.targetAmount,
      args.months,
      args.protectedReserve,
      sessionId,
    );
  } else if (name === "get_money_radar") {
    result = await getMoneyRadar(personaId, sessionId);
  } else if (name === "investigate_suspicious_payment") {
    const args = toolArgs.investigate_suspicious_payment.parse(
      JSON.parse(rawArguments),
    );
    result = await getScamGuardian(personaId, args.query, sessionId);
  } else if (name === "review_subscriptions") {
    result = await getSubscriptionReview(personaId, sessionId);
  } else if (name === "get_resilience_plan") {
    result = await getResiliencePlan(personaId, sessionId);
  } else if (name === "prepare_advisor_message") {
    const args = toolArgs.prepare_advisor_message.parse(
      JSON.parse(rawArguments),
    );
    const message = await prepareAdvisorMessage(
      personaId,
      args.topic,
      args.message,
      planEvidence,
      sessionId,
    );
    await emit({ type: "advisor_draft", message });
    result = {
      messageId: message.id,
      status: message.status,
      topic: message.topic,
      requiresApproval: true,
    };
  } else {
    throw new Error(`Unsupported tool requested: ${name}`);
  }

  await emit({
    type: "tool_result",
    id,
    name,
    detail:
      name === "search_products_and_policies" && Array.isArray(result)
        ? `${result.length} bank-controlled source${result.length === 1 ? "" : "s"} retrieved`
        : describeTool(name, "complete"),
  });
  return result;
}

export function resolveSalaryAmount(
  candidate: number | null,
  transactions: Transaction[],
) {
  if (candidate !== null && candidate > 0) {
    return candidate;
  }
  const salaryTransaction = transactions.find(
    (transaction) =>
      transaction.direction === "credit" &&
      [transaction.merchant, transaction.category, transaction.note].some(
        (value) => /salary|payroll/i.test(value),
      ),
  );
  return salaryTransaction?.amount ?? null;
}

function isEvidence(value: unknown): value is Evidence {
  return (
    typeof value === "object" &&
    value !== null &&
    "title" in value &&
    typeof value.title === "string" &&
    "detail" in value &&
    typeof value.detail === "string"
  );
}

type KnowledgeDocument = {
  id: string;
  title: string;
  content: string;
  sourceUrl: string;
  contentVector: number[];
};

export function knowledgeDocumentEvidence(
  document: Pick<KnowledgeDocument, "title" | "content" | "sourceUrl">,
): Evidence {
  return {
    title: document.title,
    detail: document.content.slice(0, 320),
    source: "Caldova policy knowledge",
    url: document.sourceUrl,
    document: document.content,
  };
}

async function searchKnowledge(query: string): Promise<Evidence[]> {
  const endpoint = process.env.SEARCH_ENDPOINT;
  if (!endpoint) {
    return localPolicyEvidence(query);
  }

  const credential = new DefaultAzureCredential();
  const openai = new AzureOpenAI({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiVersion: "2025-04-01-preview",
    azureADTokenProvider: getBearerTokenProvider(
      credential,
      "https://cognitiveservices.azure.com/.default",
    ),
  });
  const embedding = await openai.embeddings.create({
    model: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
    input: query,
  });

  const client = new SearchClient<KnowledgeDocument>(
    endpoint,
    process.env.SEARCH_INDEX_NAME ?? "banking-knowledge",
    credential,
  );
  const results = await client.search(query, {
    top: 4,
    queryType: "semantic",
    semanticSearchOptions: {
      configurationName: "banking-semantic",
    },
    vectorSearchOptions: {
      queries: [
        {
          kind: "vector",
          vector: embedding.data[0].embedding,
          fields: ["contentVector"],
          kNearestNeighborsCount: 6,
        },
      ],
    },
    select: ["id", "title", "content", "sourceUrl"],
  });

  const evidence: Evidence[] = [];
  for await (const item of results.results) {
    evidence.push(knowledgeDocumentEvidence(item.document));
  }
  return evidence;
}

function describeTool(name: string, state: "start" | "complete") {
  const label: Record<string, [string, string]> = {
    list_banking_capabilities: [
      "Reviewing available capabilities",
      "Capabilities matched",
    ],
    get_account_snapshot: ["Reading account data", "Account data verified"],
    get_last_mobile_topup: [
      "Finding the previous top-up",
      "Previous top-up matched",
    ],
    search_transactions: ["Searching transactions", "Transactions checked"],
    search_products_and_policies: [
      "Searching bank-controlled sources",
      "Grounded sources retrieved",
    ],
    prepare_money_movement: [
      "Preparing a money movement",
      "Action ready for approval",
    ],
    prepare_salary_allocation: [
      "Preparing a salary plan",
      "Salary plan ready for approval",
    ],
    get_spending_summary: [
      "Analyzing six months",
      "Monthly pattern verified",
    ],
    simulate_savings_projection: [
      "Running a grounded projection",
      "Savings projection ready",
    ],
    compare_cash_scenarios: [
      "Comparing grounded cash scenarios",
      "Scenario tradeoffs verified",
    ],
    get_money_radar: ["Scanning visible patterns", "Money Radar ready"],
    investigate_suspicious_payment: [
      "Checking observable payment signals",
      "Payment signals explained",
    ],
    review_subscriptions: [
      "Matching recurring merchants",
      "Subscriptions reviewed",
    ],
    get_resilience_plan: [
      "Calculating essential-spend coverage",
      "Resilience plan ready",
    ],
    prepare_advisor_message: [
      "Drafting a message to your advisor",
      "Advisor message ready for review",
    ],
  };
  return label[name]?.[state === "start" ? 0 : 1] ?? name;
}

function findPlanStepId(plan: AgentPlan | null, toolName: string) {
  if (!plan) return undefined;
  return (
    plan.steps.find(
      (step) => step.toolName === toolName && step.status === "running",
    )?.id ??
    plan.steps.find(
      (step) => step.toolName === toolName && step.status === "pending",
    )?.id
  );
}

function isFinancialInsight(value: unknown): value is FinancialInsight {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "evidence" in value &&
    Array.isArray(value.evidence)
  );
}

function isSpendingSummary(value: unknown): value is SpendingSummary {
  return (
    typeof value === "object" &&
    value !== null &&
    "periodMonths" in value &&
    "averageSurplus" in value &&
    "recommendedMonthlySavings" in value
  );
}

function hasApprovalIntent(
  value: unknown,
): value is { intentId: string; requiresApproval: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    "intentId" in value &&
    typeof value.intentId === "string" &&
    "requiresApproval" in value &&
    value.requiresApproval === true
  );
}

function requiresCustomerInput(
  value: unknown,
): value is { requiresCustomerInput: true; message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "requiresCustomerInput" in value &&
    value.requiresCustomerInput === true
  );
}

export function extractToolEvidence(name: string, result: unknown): Evidence[] {
  if (Array.isArray(result)) {
    return result.filter(isEvidence).map((source) => ({
      title: source.title,
      detail: source.detail,
      source: source.source,
      url: source.url,
    }));
  }
  if (
    typeof result === "object" &&
    result !== null &&
    "evidence" in result &&
    Array.isArray(result.evidence)
  ) {
    return result.evidence.filter(isEvidence);
  }
  if (isFinancialInsight(result)) {
    return result.evidence;
  }
  if (isSpendingSummary(result)) {
    return [
      {
        title: "Observed monthly capacity",
        detail: `${formatUah(result.recommendedMonthlySavings)} from ${result.periodMonths} completed months; average surplus ${formatUah(result.averageSurplus)}.`,
        source: "Transaction analysis",
      },
    ];
  }
  if (
    name === "get_account_snapshot" &&
    typeof result === "object" &&
    result !== null &&
    "accounts" in result &&
    Array.isArray(result.accounts)
  ) {
    const accounts = result.accounts as Array<{
      balance: number;
      currency: string;
      type: string;
    }>;
    const savings = accounts
      .filter((account) => account.currency === "UAH" && account.type === "savings")
      .reduce((sum, account) => sum + account.balance, 0);
    return [
      {
        title: "Visible account context",
        detail: `${accounts.length} accounts verified; ${formatUah(savings)} held in UAH savings.`,
        source: "Account balances",
      },
    ];
  }
  return [];
}

function describeProposedAction(name: string) {
  const labels: Record<string, string> = {
    prepare_money_movement: "Review money movement",
    prepare_salary_allocation: "Review salary allocation rule",
  };
  return labels[name] ?? "Review proposed action";
}

function requiredToolValue<T>(value: T | null, message: string): T {
  if (value === null) {
    throw new Error(message);
  }
  return value;
}

function formatUah(value: number) {
  return new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency: "UAH",
    maximumFractionDigits: 0,
  }).format(value);
}
