import { createHash, randomUUID } from "node:crypto";
import type {
  ActionIntent,
  AdvisorMessage,
  AdvisorTopic,
  AgentPlan,
  Dashboard,
  Evidence,
  PersonaSummary,
  SpendingSummary,
  Transaction,
} from "@/lib/types";
import {
  buildAdaptiveInsights,
  buildCashScenarioComparison,
  buildGoalPlan,
  buildLifeEventPlan,
  buildMoneyRadar,
  buildSavingsProjection,
  buildResiliencePlan,
  buildScamGuardian,
  buildSubscriptionReview,
} from "@/lib/financial-intelligence";
import {
  sqlApproveIntent,
  sqlCreateAdvisorMessage,
  sqlCreateIntent,
  sqlGetDashboard,
  sqlGetAgentPlan,
  sqlGetLastMobileTopup,
  sqlListAdvisorMessages,
  sqlListPendingIntents,
  sqlListPersonas,
  sqlResetDemoSession,
  sqlSaveAgentPlan,
  sqlSendAdvisorMessage,
  sqlSearchTransactions,
  isSqlStoreConfigured,
} from "@/lib/sql-store";
import { normalizeAgentPlan } from "@/lib/agent-plan";

type PersonaRecord = {
  summary: PersonaSummary;
  account: Dashboard["account"];
  additionalAccounts: Dashboard["accounts"];
  phone: string;
  transactions: Transaction[];
  intents: ActionIntent[];
};

type BankState = {
  personas: Map<string, PersonaRecord>;
  executedKeys: Set<string>;
  salaryRules: Map<string, ActionIntent["fields"]>;
  advisorMessages: AdvisorMessage[];
  agentPlans: Map<string, AgentPlan>;
};

export type SalaryAllocationPreferences = {
  savingsAmount?: number | null;
  savingsPercent?: number | null;
  billsAmount?: number | null;
  billsPercent?: number | null;
  minimumAvailable?: number | null;
};

export type MoneyMovementRequest =
  | {
      kind: "own_account_transfer";
      sourceAccountId: string;
      destinationAccountId: string;
      amount: number;
    }
  | {
      kind: "mobile_topup";
      sourceAccountId: string;
      phone: string;
      amount: number;
      provenance?: "customer_instruction" | "history_match";
    }
  | {
      kind: "bill_payment";
      sourceAccountId: string;
      payee: string;
      amount: number;
      reference?: string;
      dueDate?: string;
      provenance?: "customer_instruction" | "invoice_upload";
    };

declare global {
  var caldovaBankStates: Map<string, BankState> | undefined;
}

const initialPersonas: PersonaRecord[] = [
  {
    summary: {
      id: "andrii",
      name: "Andrii Kovalenko",
      initials: "AK",
      descriptor: "Salary customer",
      advisorName: "Olena Marchenko",
      advisorInitials: "OM",
    },
    account: {
      id: "acc-andrii-main",
      name: "Universal",
      maskedNumber: "•• 4821",
      balance: 18420.5,
      currency: "UAH",
      type: "current",
      network: "VISA",
    },
    additionalAccounts: [
      {
        id: "acc-andrii-digital",
        name: "Digital card",
        maskedNumber: "•• 9101",
        balance: 6815.2,
        currency: "UAH",
        type: "digital",
        network: "VISA",
      },
      {
        id: "acc-andrii-savings",
        name: "Savings jar",
        maskedNumber: "•• 3048",
        balance: 74500,
        currency: "UAH",
        type: "savings",
      },
    ],
    phone: "+380 67 ••• 42 19",
    transactions: [
      {
        id: "tx-andrii-topup",
        accountId: "acc-andrii-main",
        merchant: "Kyivstar",
        category: "Mobile top-up",
        amount: 200,
        currency: "UAH",
        bookedAt: "2026-08-28T10:15:00Z",
        direction: "debit",
        note: "Mobile top-up to +380 67 ••• 42 19",
      },
      {
        id: "tx-andrii-salary",
        accountId: "acc-andrii-main",
        merchant: "Salary",
        category: "Incoming payment",
        amount: 42800,
        currency: "UAH",
        bookedAt: "2026-08-27T08:00:00Z",
        direction: "credit",
        note: "Monthly salary",
      },
      {
        id: "tx-andrii-market",
        accountId: "acc-andrii-main",
        merchant: "Silpo",
        category: "Groceries",
        amount: 1264.3,
        currency: "UAH",
        bookedAt: "2026-08-26T18:21:00Z",
        direction: "debit",
        note: "Card purchase",
      },
    ],
    intents: [],
  },
  {
    summary: {
      id: "iryna",
      name: "Iryna Melnyk",
      initials: "IM",
      descriptor: "Household planner",
      advisorName: "Olena Marchenko",
      advisorInitials: "OM",
    },
    account: {
      id: "acc-iryna-main",
      name: "Universal",
      maskedNumber: "•• 1137",
      balance: 12580.25,
      currency: "UAH",
      type: "current",
      network: "Mastercard",
    },
    additionalAccounts: [
      {
        id: "acc-iryna-family",
        name: "Family card",
        maskedNumber: "•• 6420",
        balance: 9340.8,
        currency: "UAH",
        type: "digital",
        network: "VISA",
      },
      {
        id: "acc-iryna-savings",
        name: "Family reserve",
        maskedNumber: "•• 2215",
        balance: 38600,
        currency: "UAH",
        type: "savings",
      },
    ],
    phone: "+380 50 ••• 18 04",
    transactions: [
      {
        id: "tx-iryna-netflix",
        accountId: "acc-iryna-main",
        merchant: "Netflix",
        category: "Subscriptions",
        amount: 429,
        currency: "UAH",
        bookedAt: "2026-08-31T06:00:00Z",
        direction: "debit",
        note: "Recurring subscription; increased by ₴60",
      },
      {
        id: "tx-iryna-atb",
        accountId: "acc-iryna-main",
        merchant: "ATB",
        category: "Groceries",
        amount: 1842.4,
        currency: "UAH",
        bookedAt: "2026-08-30T17:05:00Z",
        direction: "debit",
        note: "Card purchase",
      },
    ],
    intents: [],
  },
  {
    summary: {
      id: "oleksii",
      name: "Oleksii Bondar",
      initials: "OB",
      descriptor: "Frequent traveler",
      advisorName: "Olena Marchenko",
      advisorInitials: "OM",
    },
    account: {
      id: "acc-oleksii-main",
      name: "Universal",
      maskedNumber: "•• 7072",
      balance: 31240.8,
      currency: "UAH",
      type: "current",
      network: "VISA",
    },
    additionalAccounts: [
      {
        id: "acc-oleksii-travel",
        name: "Travel card",
        maskedNumber: "•• 3377",
        balance: 1430.55,
        currency: "EUR",
        type: "travel",
        network: "Mastercard",
      },
      {
        id: "acc-oleksii-digital",
        name: "Digital card",
        maskedNumber: "•• 1956",
        balance: 4720,
        currency: "UAH",
        type: "digital",
        network: "VISA",
      },
    ],
    phone: "+380 93 ••• 77 20",
    transactions: [
      {
        id: "tx-oleksii-hotel",
        accountId: "acc-oleksii-main",
        merchant: "Scandic Stockholm",
        category: "Travel",
        amount: 6850,
        currency: "UAH",
        bookedAt: "2026-08-30T15:10:00Z",
        direction: "debit",
        note: "SEK card purchase converted to UAH",
      },
      {
        id: "tx-oleksii-fx",
        accountId: "acc-oleksii-main",
        merchant: "Foreign exchange fee",
        category: "Bank fee",
        amount: 102.75,
        currency: "UAH",
        bookedAt: "2026-08-30T15:11:00Z",
        direction: "debit",
        note: "1.5% non-UAH transaction fee",
      },
    ],
    intents: [],
  },
  {
    summary: {
      id: "sofia",
      name: "Sofia Hrytsenko",
      initials: "SH",
      descriptor: "Freelancer",
      advisorName: "Olena Marchenko",
      advisorInitials: "OM",
    },
    account: {
      id: "acc-sofia-main",
      name: "Digital",
      maskedNumber: "•• 2964",
      balance: 8240.1,
      currency: "UAH",
      type: "digital",
      network: "VISA",
    },
    additionalAccounts: [
      {
        id: "acc-sofia-tax",
        name: "Tax reserve",
        maskedNumber: "•• 8804",
        balance: 19650,
        currency: "UAH",
        type: "savings",
      },
    ],
    phone: "+380 66 ••• 09 51",
    transactions: [
      {
        id: "tx-sofia-client",
        accountId: "acc-sofia-main",
        merchant: "Design client",
        category: "Incoming payment",
        amount: 19600,
        currency: "UAH",
        bookedAt: "2026-08-22T09:40:00Z",
        direction: "credit",
        note: "Invoice 2026-081",
      },
      {
        id: "tx-sofia-tax",
        accountId: "acc-sofia-main",
        merchant: "Tax reserve",
        category: "Savings",
        amount: 3900,
        currency: "UAH",
        bookedAt: "2026-08-22T09:45:00Z",
        direction: "debit",
        note: "Manual reserve transfer",
      },
    ],
    intents: [],
  },
  {
    summary: {
      id: "danylo",
      name: "Danylo Savchuk",
      initials: "DS",
      descriptor: "Security-conscious",
      advisorName: "Olena Marchenko",
      advisorInitials: "OM",
    },
    account: {
      id: "acc-danylo-main",
      name: "Universal",
      maskedNumber: "•• 8550",
      balance: 22105.65,
      currency: "UAH",
      type: "current",
      network: "Mastercard",
    },
    additionalAccounts: [
      {
        id: "acc-danylo-internet",
        name: "Internet card",
        maskedNumber: "•• 0098",
        balance: 2500,
        currency: "UAH",
        type: "digital",
        network: "VISA",
      },
    ],
    phone: "+380 68 ••• 31 88",
    transactions: [
      {
        id: "tx-danylo-merchant",
        accountId: "acc-danylo-main",
        merchant: "DIGITALRIVER IE",
        category: "Online purchase",
        amount: 1499,
        currency: "UAH",
        bookedAt: "2026-09-01T23:42:00Z",
        direction: "debit",
        note: "Card-not-present transaction; merchant of record",
      },
      {
        id: "tx-danylo-pharmacy",
        accountId: "acc-danylo-main",
        merchant: "ANC Pharmacy",
        category: "Health",
        amount: 638.2,
        currency: "UAH",
        bookedAt: "2026-08-30T12:19:00Z",
        direction: "debit",
        note: "Card purchase",
      },
    ],
    intents: [],
  },
];

function createInitialState(): BankState {
  return {
    personas: new Map(
      initialPersonas.map((persona) => [
        persona.summary.id,
        structuredClone(persona),
      ]),
    ),
    executedKeys: new Set<string>(),
    salaryRules: new Map(),
    advisorMessages: [],
    agentPlans: new Map(),
  };
}

function state(sessionId = "local-default") {
  globalThis.caldovaBankStates ??= new Map();
  if (!globalThis.caldovaBankStates.has(sessionId)) {
    globalThis.caldovaBankStates.set(sessionId, createInitialState());
  }
  return globalThis.caldovaBankStates.get(sessionId)!;
}

function getPersonaRecord(personaId: string, sessionId = "local-default") {
  const persona = state(sessionId).personas.get(personaId);
  if (!persona) {
    throw new Error(`Unknown persona: ${personaId}`);
  }
  return persona;
}

function memoryListPersonas(): PersonaSummary[] {
  return initialPersonas.map((persona) => persona.summary);
}

function memoryGetDashboard(personaId: string, sessionId: string): Dashboard {
  const persona = getPersonaRecord(personaId, sessionId);
  return {
    persona: { ...persona.summary },
    account: { ...persona.account },
    accounts: [
      { ...persona.account },
      ...structuredClone(persona.additionalAccounts),
    ],
    phone: persona.phone,
    transactions: structuredClone(persona.transactions.slice(0, 6)),
    aiMode: process.env.FOUNDRY_PROJECT_ENDPOINT
      ? "foundry"
      : "local-preview",
  };
}

function memoryGetLastMobileTopup(personaId: string, sessionId: string) {
  const persona = getPersonaRecord(personaId, sessionId);
  const transaction = persona.transactions.find(
    (item) => item.category === "Mobile top-up",
  );
  if (!transaction) {
    return null;
  }
  return {
    amount: transaction.amount,
    phone: persona.phone,
    operator: transaction.merchant,
    bookedAt: transaction.bookedAt,
    transactionId: transaction.id,
  };
}

function memorySearchTransactions(
  personaId: string,
  query: string,
  sessionId: string,
) {
  const normalized = query.toLocaleLowerCase();
  return getPersonaRecord(personaId, sessionId).transactions.filter((transaction) =>
    [
      transaction.merchant,
      transaction.category,
      transaction.note,
    ].some((value) => value.toLocaleLowerCase().includes(normalized)),
  );
}

type IntentContext = Pick<
  Dashboard,
  "persona" | "account" | "accounts" | "phone"
>;

function buildMobileTopupIntent(
  context: IntentContext,
  amount: number,
  phone?: string,
  sourceAccountId = context.account.id,
  provenance: "customer_instruction" | "history_match" = "customer_instruction",
) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Top-up amount must be positive.");
  }
  if (amount > 5000) {
    throw new Error("Top-up exceeds the synthetic daily limit.");
  }
  const source = context.accounts.find(
    (account) => account.id === sourceAccountId,
  );
  if (!source) {
    throw new Error("The source account must belong to this customer.");
  }
  if (source.currency !== "UAH") {
    throw new Error("Mobile top-ups require a UAH source account.");
  }
  if (amount > source.balance) {
    throw new Error("The source account does not have enough available balance.");
  }
  return {
    id: randomUUID(),
    personaId: context.persona.id,
    type: "mobile_topup",
    title: "Mobile top-up",
    status: "awaiting_approval",
    amount,
    fee: 0,
    sourceAccountId: source.id,
    sourceAccountLabel: `${source.name} ${source.maskedNumber}`,
    destinationLabel: phone ?? context.phone,
    fields: [
      { label: "Phone", value: phone ?? context.phone },
      { label: "Amount", value: formatMoney(amount) },
      {
        label: "From",
        value: `${source.name} ${source.maskedNumber}`,
      },
      { label: "Fee", value: "₴ 0.00" },
    ],
    evidence: [
      {
        title: "Intent verified",
        detail: "A mobile top-up was requested.",
      },
      ...(provenance === "history_match"
        ? [
            {
              title: "History matched",
              detail: `The previous top-up was ${formatMoney(amount)} to this number.`,
            },
          ]
        : [
            {
              title: "Customer instruction",
              detail: "The amount and phone came from the current request.",
            },
          ]),
      {
        title: "Policy checked",
        detail: "Amount is within the synthetic daily top-up limit of ₴5,000.",
        source: "Mobile top-up policy",
      },
    ],
    createdAt: new Date().toISOString(),
  } satisfies ActionIntent;
}

function memoryPrepareMobileTopup(
  personaId: string,
  amount: number,
  phone?: string,
  sessionId = "local-default",
  sourceAccountId?: string,
) {
  const persona = getPersonaRecord(personaId, sessionId);
  const intent = buildMobileTopupIntent(
    memoryGetDashboard(personaId, sessionId),
    amount,
    phone,
    sourceAccountId,
  );
  persona.intents.unshift(intent);
  return intent;
}

function buildAccountTransferIntent(
  context: IntentContext,
  sourceAccountId: string,
  destinationAccountId: string,
  amount: number,
) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Transfer amount must be positive.");
  }
  if (sourceAccountId === destinationAccountId) {
    throw new Error("Choose two different accounts for the transfer.");
  }

  const source = context.accounts.find(
    (account) => account.id === sourceAccountId,
  );
  const destination = context.accounts.find(
    (account) => account.id === destinationAccountId,
  );
  if (!source || !destination) {
    throw new Error("Both transfer accounts must belong to this customer.");
  }
  if (source.currency !== destination.currency) {
    throw new Error(
      "Transfers between accounts with different currencies are not supported.",
    );
  }
  if (amount > source.balance) {
    throw new Error("The source account does not have enough available balance.");
  }

  const sourceLabel = `${source.name} ${source.maskedNumber}`;
  const destinationLabel = `${destination.name} ${destination.maskedNumber}`;
  return {
    id: randomUUID(),
    personaId: context.persona.id,
    type: "account_transfer",
    title: `Transfer to ${destination.name}`,
    status: "awaiting_approval",
    amount: roundMoney(amount),
    fee: 0,
    sourceAccountId: source.id,
    sourceAccountLabel: sourceLabel,
    destinationAccountId: destination.id,
    destinationLabel,
    fields: [
      { label: "From", value: sourceLabel },
      { label: "To", value: destinationLabel },
      { label: "Amount", value: formatMoney(amount) },
      { label: "Fee", value: formatMoney(0) },
    ],
    evidence: [
      {
        title: "Accounts verified",
        detail: "Both accounts belong to the selected customer.",
      },
      {
        title: "Balance checked",
        detail: `${formatMoney(source.balance)} is available before transfer.`,
      },
      {
        title: "Approval required",
        detail: "No money moves until you approve this exact transfer.",
      },
    ],
    createdAt: new Date().toISOString(),
  } satisfies ActionIntent;
}

function memoryPrepareAccountTransfer(
  personaId: string,
  sourceAccountId: string,
  destinationAccountId: string,
  amount: number,
  sessionId: string,
) {
  const persona = getPersonaRecord(personaId, sessionId);
  const intent = buildAccountTransferIntent(
    memoryGetDashboard(personaId, sessionId),
    sourceAccountId,
    destinationAccountId,
    amount,
  );
  persona.intents.unshift(intent);
  return intent;
}

function buildSalaryAllocationIntent(
  context: IntentContext,
  salary: number,
  preferences: SalaryAllocationPreferences = {},
) {
  if (!Number.isFinite(salary) || salary <= 0) {
    throw new Error("Salary must be a positive amount.");
  }

  const resolveAmount = (
    amount: number | null | undefined,
    percent: number | null | undefined,
    defaultPercent: number,
    label: string,
  ) => {
    if (
      amount !== null &&
      amount !== undefined &&
      percent !== null &&
      percent !== undefined
    ) {
      throw new Error(
        `Specify ${label} as either an amount or a percentage, not both.`,
      );
    }
    if (amount !== null && amount !== undefined) {
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error(`${label} amount cannot be negative.`);
      }
      return { amount: roundMoney(amount), instruction: formatMoney(amount) };
    }
    const appliedPercent = percent ?? defaultPercent;
    if (
      !Number.isFinite(appliedPercent) ||
      appliedPercent < 0 ||
      appliedPercent > 100
    ) {
      throw new Error(`${label} percentage must be between 0 and 100.`);
    }
    return {
      amount: roundMoney((salary * appliedPercent) / 100),
      instruction: `${appliedPercent}% of salary`,
    };
  };

  const requestedSavings = resolveAmount(
    preferences.savingsAmount,
    preferences.savingsPercent,
    30,
    "Savings",
  );
  const requestedBills = resolveAmount(
    preferences.billsAmount,
    preferences.billsPercent,
    20,
    "Bills",
  );
  const minimumAvailable = roundMoney(preferences.minimumAvailable ?? 10_000);
  if (!Number.isFinite(minimumAvailable) || minimumAvailable < 0) {
    throw new Error("Minimum available reserve cannot be negative.");
  }

  const allocatable = roundMoney(salary - minimumAvailable);
  if (allocatable < 0 || requestedBills.amount > allocatable) {
    throw new Error(
      `The bills allocation cannot preserve the requested ${formatMoney(minimumAvailable)} available reserve.`,
    );
  }
  const savings = Math.min(
    requestedSavings.amount,
    roundMoney(allocatable - requestedBills.amount),
  );
  const bills = requestedBills.amount;
  const savingsWasCapped = savings < requestedSavings.amount;

  return {
    id: randomUUID(),
    personaId: context.persona.id,
    type: "salary_rule",
    title: "Salary automation rule",
    status: "awaiting_approval",
    amount: savings + bills,
    fee: 0,
    sourceAccountId: context.account.id,
    sourceAccountLabel: `${context.account.name} ${context.account.maskedNumber}`,
    destinationLabel: "Bills pocket and Safety reserve",
    fields: [
      { label: "Salary detected", value: formatMoney(salary) },
      { label: "Savings instruction", value: requestedSavings.instruction },
      { label: "Bills pocket", value: formatMoney(bills) },
      { label: "Safety reserve", value: formatMoney(savings) },
      { label: "Bills instruction", value: requestedBills.instruction },
      {
        label: "Minimum left available",
        value: formatMoney(minimumAvailable),
      },
      {
        label: "Available after plan",
        value: formatMoney(salary - savings - bills),
      },
    ],
    evidence: [
      {
        title: "Salary event received",
        detail: `Incoming salary of ${formatMoney(salary)} was posted.`,
      },
      {
        title: "Reserve protected",
        detail: `The plan keeps at least ${formatMoney(minimumAvailable)} available.`,
      },
      ...(savingsWasCapped
        ? [
            {
              title: "Savings adjusted",
              detail: `The requested ${formatMoney(requestedSavings.amount)} was capped at ${formatMoney(savings)} to preserve the available reserve.`,
            },
          ]
        : []),
      {
        title: "Customer instructions applied",
        detail: `Savings: ${requestedSavings.instruction}. Bills: ${requestedBills.instruction}.`,
      },
      {
        title: "Approval required",
        detail: "No automation or transfer is activated until approved.",
      },
    ],
    createdAt: new Date().toISOString(),
  } satisfies ActionIntent;
}

function memoryPrepareSalaryAllocation(
  personaId: string,
  salary: number,
  sessionId: string,
  preferences: SalaryAllocationPreferences = {},
) {
  const persona = getPersonaRecord(personaId, sessionId);
  const intent = buildSalaryAllocationIntent(
    memoryGetDashboard(personaId, sessionId),
    salary,
    preferences,
  );
  persona.intents.unshift(intent);
  return intent;
}

function buildBillPaymentIntent(
  context: IntentContext,
  merchant: string,
  amount: number,
  reference?: string,
  dueDate?: string,
  sourceAccountId = context.account.id,
  provenance: "customer_instruction" | "invoice_upload" = "invoice_upload",
) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invoice total must be a positive amount.");
  }
  const source = context.accounts.find(
    (account) => account.id === sourceAccountId,
  );
  if (!source) {
    throw new Error("The source account must belong to this customer.");
  }
  if (source.currency !== "UAH") {
    throw new Error("Bill payments require a UAH source account.");
  }
  if (amount > source.balance) {
    throw new Error("The selected account does not have enough available balance.");
  }
  return {
    id: crypto.randomUUID(),
    personaId: context.persona.id,
    type: "bill_payment",
    title: `Pay ${merchant}`,
    status: "awaiting_approval",
    amount,
    fee: 0,
    sourceAccountId: source.id,
    sourceAccountLabel: `${source.name} · ${source.maskedNumber}`,
    destinationLabel: merchant,
    fields: [
      { label: "Payee", value: merchant },
      { label: "Amount", value: formatMoney(amount) },
      ...(reference ? [{ label: "Reference", value: reference }] : []),
      ...(dueDate ? [{ label: "Due date", value: dueDate }] : []),
      { label: "Fee", value: formatMoney(0) },
    ],
    evidence: [
      ...(provenance === "invoice_upload"
        ? [
            {
              title: "Invoice understood",
              detail:
                "Azure AI Document Intelligence extracted the payee and amount from the uploaded invoice.",
            },
          ]
        : [
            {
              title: "Customer instruction",
              detail: "The payee and amount came from the current request.",
            },
          ]),
      {
        title: "Balance checked",
        detail: `${formatMoney(source.balance)} is available before payment.`,
      },
      {
        title: "Approval required",
        detail: "No payment can be posted until you approve this exact proposal.",
      },
    ],
    createdAt: new Date().toISOString(),
  } satisfies ActionIntent;
}

function memoryPrepareBillPayment(
  personaId: string,
  merchant: string,
  amount: number,
  reference?: string,
  dueDate?: string,
  sessionId = "local-default",
  sourceAccountId?: string,
) {
  const persona = getPersonaRecord(personaId, sessionId);
  const intent = buildBillPaymentIntent(
    memoryGetDashboard(personaId, sessionId),
    merchant,
    amount,
    reference,
    dueDate,
    sourceAccountId,
  );
  persona.intents.push(intent);
  return structuredClone(intent);
}

function memoryListPendingIntents(personaId: string, sessionId: string) {
  return getPersonaRecord(personaId, sessionId).intents.filter(
    (intent) => intent.status === "awaiting_approval",
  );
}

function memoryApproveIntent(
  personaId: string,
  intentId: string,
  sessionId: string,
): { intent: ActionIntent; dashboard: Dashboard } {
  const persona = getPersonaRecord(personaId, sessionId);
  const intent = persona.intents.find((item) => item.id === intentId);
  if (!intent || intent.personaId !== personaId) {
    throw new Error("Intent not found for this persona.");
  }
  if (intent.status !== "awaiting_approval") {
    throw new Error(`Intent cannot be approved from ${intent.status}.`);
  }

  const idempotencyKey = createHash("sha256")
    .update(`${personaId}:${intent.id}:${intent.amount}`)
    .digest("hex");
  if (state(sessionId).executedKeys.has(idempotencyKey)) {
    throw new Error("This intent has already been executed.");
  }

  const sourceAccount =
    intent.sourceAccountId === persona.account.id
      ? persona.account
      : persona.additionalAccounts.find(
          (account) => account.id === intent.sourceAccountId,
        );
  if (!sourceAccount) {
    intent.status = "failed";
    throw new Error("Source account is no longer available.");
  }
  if (
    intent.type !== "salary_rule" &&
    intent.amount + intent.fee > sourceAccount.balance
  ) {
    intent.status = "failed";
    throw new Error("Insufficient balance for this action.");
  }
  if (intent.type === "mobile_topup" && intent.amount > 5000) {
    intent.status = "failed";
    throw new Error("Top-up exceeds the synthetic daily limit.");
  }

  const destinationAccount =
    intent.type === "account_transfer"
      ? persona.additionalAccounts
          .concat(persona.account)
          .find((account) => account.id === intent.destinationAccountId)
      : undefined;
  if (intent.type === "account_transfer" && !destinationAccount) {
    intent.status = "failed";
    throw new Error("Destination account is no longer available.");
  }
  if (
    destinationAccount &&
    destinationAccount.currency !== sourceAccount.currency
  ) {
    intent.status = "failed";
    throw new Error("The transfer accounts no longer use the same currency.");
  }

  intent.status = "approved";
  const now = new Date().toISOString();
  if (intent.type === "salary_rule") {
    state(sessionId).salaryRules.set(personaId, structuredClone(intent.fields));
  } else if (intent.type === "salary_allocation") {
    executeMemorySalaryAllocation(persona, intent, now);
  } else {
    sourceAccount.balance = roundMoney(
      sourceAccount.balance - intent.amount - intent.fee,
    );
    persona.transactions.unshift({
      id: randomUUID(),
      accountId: sourceAccount.id,
      merchant: intent.destinationLabel,
      category:
        intent.type === "mobile_topup"
          ? "Mobile top-up"
          : intent.type === "account_transfer"
            ? "Transfer"
            : "Bills",
      amount: intent.amount,
      currency: sourceAccount.currency,
      bookedAt: now,
      direction: "debit",
      note: intent.destinationLabel,
    });
    if (intent.type === "account_transfer" && destinationAccount) {
      destinationAccount.balance = roundMoney(
        destinationAccount.balance + intent.amount,
      );
      persona.transactions.unshift({
        id: randomUUID(),
        accountId: destinationAccount.id,
        merchant: intent.sourceAccountLabel,
        category: "Transfer",
        amount: intent.amount,
        currency: destinationAccount.currency,
        bookedAt: now,
        direction: "credit",
        note: `Transfer from ${intent.sourceAccountLabel}`,
      });
    }
  }
  state(sessionId).executedKeys.add(idempotencyKey);
  intent.status = "completed";
  intent.receipt = `P24-${now.slice(0, 10).replaceAll("-", "")}-${intent.id
    .slice(0, 8)
    .toUpperCase()}`;
  return { intent, dashboard: memoryGetDashboard(personaId, sessionId) };
}

function executeMemorySalaryAllocation(
  persona: PersonaRecord,
  intent: ActionIntent,
  bookedAt: string,
) {
  const billsAmount = parseIntentMoney(intent.fields, "Bills pocket");
  const savingsAmount = parseIntentMoney(intent.fields, "Move to savings");
  const savingsAccount = persona.additionalAccounts.find(
    (account) =>
      account.currency === persona.account.currency && account.type === "savings",
  );
  const billsAccount = persona.additionalAccounts.find(
    (account) =>
      account.currency === persona.account.currency &&
      account.type !== "savings",
  );
  if (!savingsAccount || !billsAccount) {
    throw new Error(
      "This customer needs both a savings account and a bills account for salary allocation.",
    );
  }
  const movements = [
    { account: billsAccount, amount: billsAmount, label: "Bills allocation" },
    { account: savingsAccount, amount: savingsAmount, label: "Savings allocation" },
  ].filter((movement) => movement.amount > 0);
  const total = roundMoney(
    movements.reduce((sum, movement) => sum + movement.amount, 0),
  );
  if (total > persona.account.balance) {
    throw new Error("Insufficient balance for this salary allocation.");
  }

  persona.account.balance = roundMoney(persona.account.balance - total);
  for (const movement of movements) {
    movement.account.balance = roundMoney(
      movement.account.balance + movement.amount,
    );
    persona.transactions.unshift(
      {
        id: randomUUID(),
        accountId: movement.account.id,
        merchant: persona.account.name,
        category: "Transfer",
        amount: movement.amount,
        currency: movement.account.currency,
        bookedAt,
        direction: "credit",
        note: movement.label,
      },
      {
        id: randomUUID(),
        accountId: persona.account.id,
        merchant: movement.account.name,
        category: "Transfer",
        amount: movement.amount,
        currency: persona.account.currency,
        bookedAt,
        direction: "debit",
        note: movement.label,
      },
    );
  }
}

function parseIntentMoney(
  fields: ActionIntent["fields"],
  label: string,
) {
  const value = fields.find((field) => field.label === label)?.value;
  if (!value) return 0;
  return parseFormattedMoney(value);
}

export async function listPersonas(): Promise<PersonaSummary[]> {
  return isSqlStoreConfigured() ? sqlListPersonas() : memoryListPersonas();
}

export async function getDashboard(
  personaId: string,
  sessionId = "local-default",
): Promise<Dashboard> {
  return isSqlStoreConfigured()
    ? sqlGetDashboard(personaId, sessionId)
    : memoryGetDashboard(personaId, sessionId);
}

export async function getLastMobileTopup(
  personaId: string,
  sessionId = "local-default",
) {
  return isSqlStoreConfigured()
    ? sqlGetLastMobileTopup(personaId, sessionId)
    : memoryGetLastMobileTopup(personaId, sessionId);
}

export async function searchTransactions(
  personaId: string,
  query: string,
  sessionId = "local-default",
) {
  return isSqlStoreConfigured()
    ? sqlSearchTransactions(personaId, query, sessionId)
    : memorySearchTransactions(personaId, query, sessionId);
}

export async function getSpendingSummary(
  personaId: string,
  sessionId = "local-default",
): Promise<SpendingSummary> {
  return calculateSpendingSummary(
    (await getDashboard(personaId, sessionId)).transactions,
  );
}

export async function getSavingsProjection(
  personaId: string,
  monthlySavingAmount: number,
  months: number,
  sessionId = "local-default",
) {
  const dashboard = await getDashboard(personaId, sessionId);
  return buildSavingsProjection(
    dashboard,
    calculateSpendingSummary(dashboard.transactions),
    monthlySavingAmount,
    months,
  );
}

export async function getGoalPlan(
  personaId: string,
  targetAmount: number,
  months: number,
  goalName: string,
  sessionId = "local-default",
) {
  const dashboard = await getDashboard(personaId, sessionId);
  return buildGoalPlan(
    dashboard,
    calculateSpendingSummary(dashboard.transactions),
    targetAmount,
    months,
    goalName,
  );
}

export async function compareCashScenarios(
  personaId: string,
  goalName: string,
  targetAmount: number,
  months: number,
  protectedReserve: number,
  sessionId = "local-default",
) {
  const dashboard = await getDashboard(personaId, sessionId);
  return buildCashScenarioComparison(
    dashboard,
    calculateSpendingSummary(dashboard.transactions),
    goalName,
    targetAmount,
    months,
    protectedReserve,
  );
}

export async function getAgentPlan(
  personaId: string,
  sessionId = "local-default",
) {
  const plan = isSqlStoreConfigured()
    ? sqlGetAgentPlan(personaId, sessionId)
    : (state(sessionId).agentPlans.get(personaId) ?? null);
  return normalizeAgentPlan(await plan);
}

export async function saveAgentPlan(
  personaId: string,
  plan: AgentPlan,
  sessionId = "local-default",
) {
  if (isSqlStoreConfigured()) {
    return sqlSaveAgentPlan(personaId, plan, sessionId);
  }
  state(sessionId).agentPlans.set(personaId, structuredClone(plan));
  return plan;
}

export async function getMoneyRadar(
  personaId: string,
  sessionId = "local-default",
) {
  const dashboard = await getDashboard(personaId, sessionId);
  return buildMoneyRadar(
    dashboard,
    calculateSpendingSummary(dashboard.transactions),
  );
}

export async function getScamGuardian(
  personaId: string,
  query: string,
  sessionId = "local-default",
) {
  return buildScamGuardian(await getDashboard(personaId, sessionId), query);
}

export async function getLifeEventPlan(
  personaId: string,
  eventName: string,
  targetAmount: number,
  months: number,
  sessionId = "local-default",
) {
  const dashboard = await getDashboard(personaId, sessionId);
  return buildLifeEventPlan(
    dashboard,
    calculateSpendingSummary(dashboard.transactions),
    eventName,
    targetAmount,
    months,
  );
}

export async function getAdaptiveInsights(
  personaId: string,
  sessionId = "local-default",
) {
  const dashboard = await getDashboard(personaId, sessionId);
  return buildAdaptiveInsights(
    dashboard,
    calculateSpendingSummary(dashboard.transactions),
  );
}

export async function getSubscriptionReview(
  personaId: string,
  sessionId = "local-default",
) {
  return buildSubscriptionReview(await getDashboard(personaId, sessionId));
}

export async function getResiliencePlan(
  personaId: string,
  sessionId = "local-default",
) {
  const dashboard = await getDashboard(personaId, sessionId);
  return buildResiliencePlan(
    dashboard,
    calculateSpendingSummary(dashboard.transactions),
  );
}

export async function prepareAdvisorMessage(
  personaId: string,
  topic: AdvisorTopic,
  body: string,
  evidence: Evidence[] = [],
  sessionId = "local-default",
): Promise<AdvisorMessage> {
  const message: AdvisorMessage = {
    id: randomUUID(),
    personaId,
    status: "draft",
    topic,
    body,
    evidence: evidence.slice(0, 6),
    createdAt: new Date().toISOString(),
  };
  if (isSqlStoreConfigured()) {
    return sqlCreateAdvisorMessage(message, sessionId);
  }
  state(sessionId).advisorMessages.unshift(message);
  return structuredClone(message);
}

export async function listAdvisorMessages(
  personaId: string,
  sessionId = "local-default",
) {
  if (isSqlStoreConfigured()) {
    return sqlListAdvisorMessages(personaId, sessionId);
  }
  return structuredClone(
    state(sessionId).advisorMessages.filter(
      (message) => message.personaId === personaId,
    ),
  );
}

export async function sendAdvisorMessage(
  personaId: string,
  messageId: string,
  sessionId = "local-default",
) {
  if (isSqlStoreConfigured()) {
    return sqlSendAdvisorMessage(personaId, messageId, sessionId);
  }
  const message = state(sessionId).advisorMessages.find(
    (candidate) =>
      candidate.id === messageId && candidate.personaId === personaId,
  );
  if (!message || message.status !== "draft") {
    throw new Error("Advisor message draft was not found or was already sent.");
  }
  message.status = "sent";
  message.sentAt = new Date().toISOString();
  return structuredClone(message);
}

export function calculateSpendingSummary(
  transactions: Transaction[],
  now = new Date(),
  periodMonths = 6,
): SpendingSummary {
  const currentMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const months = Array.from({ length: periodMonths }, (_, index) => {
    const date = new Date(
      Date.UTC(
        currentMonth.getUTCFullYear(),
        currentMonth.getUTCMonth() - periodMonths + index,
        1,
      ),
    );
    return {
      key: date.toISOString().slice(0, 7),
      income: 0,
      spending: 0,
    };
  });
  const start = new Date(`${months[0].key}-01T00:00:00.000Z`);
  const monthMap = new Map(months.map((month) => [month.key, month]));
  const categoryTotals = new Map<string, number>();

  for (const transaction of transactions) {
    const bookedAt = new Date(transaction.bookedAt);
    if (
      transaction.currency !== "UAH" ||
      bookedAt < start ||
      bookedAt >= currentMonth
    ) {
      continue;
    }
    const month = monthMap.get(transaction.bookedAt.slice(0, 7));
    if (!month) continue;
    const isIncome =
      transaction.direction === "credit" &&
      /salary|incoming payment|freelance income|payroll/i.test(
        `${transaction.merchant} ${transaction.category} ${transaction.note}`,
      );
    const isInternalTransfer = /savings|transfer|reserve/i.test(
      transaction.category,
    );
    if (isIncome) {
      month.income += transaction.amount;
    } else if (transaction.direction === "debit" && !isInternalTransfer) {
      month.spending += transaction.amount;
      categoryTotals.set(
        transaction.category,
        (categoryTotals.get(transaction.category) ?? 0) + transaction.amount,
      );
    }
  }

  const monthly = months.map((month) => ({
    month: month.key,
    income: roundMoney(month.income),
    spending: roundMoney(month.spending),
    surplus: roundMoney(month.income - month.spending),
  }));
  const averageIncome = roundMoney(
    monthly.reduce((sum, month) => sum + month.income, 0) / periodMonths,
  );
  const averageSpending = roundMoney(
    monthly.reduce((sum, month) => sum + month.spending, 0) / periodMonths,
  );
  const averageSurplus = roundMoney(averageIncome - averageSpending);
  const safeSavings = Math.max(
    0,
    Math.min(averageSurplus * 0.5, averageIncome * 0.15),
  );

  return {
    periodMonths,
    monthly,
    averageIncome,
    averageSpending,
    averageSurplus,
    recommendedMonthlySavings: Math.floor(safeSavings / 100) * 100,
    categories: [...categoryTotals.entries()]
      .map(([category, total]) => ({
        category,
        monthlyAverage: roundMoney(total / periodMonths),
      }))
      .sort((left, right) => right.monthlyAverage - left.monthlyAverage),
    methodology:
      "Uses six completed months of UAH income and external spending. The recommendation is capped at 15% of average income and 50% of average surplus.",
  };
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export async function prepareMobileTopup(
  personaId: string,
  amount: number,
  phone?: string,
  sessionId = "local-default",
) {
  if (isSqlStoreConfigured()) {
    const dashboard = await sqlGetDashboard(personaId, sessionId);
    return sqlCreateIntent(
      buildMobileTopupIntent(dashboard, amount, phone, dashboard.account.id),
      sessionId,
    );
  }
  return memoryPrepareMobileTopup(personaId, amount, phone, sessionId);
}

export async function prepareAccountTransfer(
  personaId: string,
  sourceAccountId: string,
  destinationAccountId: string,
  amount: number,
  sessionId = "local-default",
) {
  if (isSqlStoreConfigured()) {
    const dashboard = await sqlGetDashboard(personaId, sessionId);
    return sqlCreateIntent(
      buildAccountTransferIntent(
        dashboard,
        sourceAccountId,
        destinationAccountId,
        amount,
      ),
      sessionId,
    );
  }
  return memoryPrepareAccountTransfer(
    personaId,
    sourceAccountId,
    destinationAccountId,
    amount,
    sessionId,
  );
}

export async function prepareMoneyMovement(
  personaId: string,
  request: MoneyMovementRequest,
  sessionId = "local-default",
) {
  const dashboard = await getDashboard(personaId, sessionId);
  let intent: ActionIntent;

  if (request.kind === "own_account_transfer") {
    intent = buildAccountTransferIntent(
      dashboard,
      request.sourceAccountId,
      request.destinationAccountId,
      request.amount,
    );
  } else if (request.kind === "mobile_topup") {
    intent = buildMobileTopupIntent(
      dashboard,
      request.amount,
      request.phone,
      request.sourceAccountId,
      request.provenance ?? "customer_instruction",
    );
  } else {
    intent = buildBillPaymentIntent(
      dashboard,
      request.payee,
      request.amount,
      request.reference,
      request.dueDate,
      request.sourceAccountId,
      request.provenance ?? "customer_instruction",
    );
  }

  if (isSqlStoreConfigured()) {
    return sqlCreateIntent(intent, sessionId);
  }
  getPersonaRecord(personaId, sessionId).intents.unshift(intent);
  return intent;
}

export async function prepareSalaryEventAllocation(
  personaId: string,
  salary: number,
  sessionId = "local-default",
) {
  if (isSqlStoreConfigured()) {
    throw new Error(
      "SQL salary events must be processed through the Service Bus worker.",
    );
  }
  const dashboard = memoryGetDashboard(personaId, sessionId);
  const approvedRule = state(sessionId).salaryRules.get(personaId);
  const intent = buildSalaryEventIntent(dashboard, salary, approvedRule);
  const persona = getPersonaRecord(personaId, sessionId);
  persona.account.balance = roundMoney(persona.account.balance + salary);
  persona.transactions.unshift({
    id: randomUUID(),
    accountId: persona.account.id,
    merchant: "Salary",
    category: "Incoming payment",
    amount: salary,
    currency: persona.account.currency,
    bookedAt: new Date().toISOString(),
    direction: "credit",
    note: "Salary event",
  });
  persona.intents.unshift(intent);
  return intent;
}

function buildSalaryEventIntent(
  dashboard: Dashboard,
  salary: number,
  approvedRule?: ActionIntent["fields"],
) {
  const savingsInstruction =
    approvedRule?.find((field) => field.label === "Savings instruction")?.value ??
    "15% of salary";
  const billsInstruction =
    approvedRule?.find((field) => field.label === "Bills instruction")?.value ??
    "45% of salary";
  const minimumAvailable =
    approvedRule?.find((field) => field.label === "Minimum left available")
      ?.value ?? formatMoney(salary * 0.3);
  const savings = resolveSalaryInstruction(savingsInstruction, salary);
  const bills = resolveSalaryInstruction(billsInstruction, salary);
  const minimum = parseFormattedMoney(minimumAvailable);
  const allocatable = roundMoney(salary - minimum);
  if (bills > allocatable) {
    throw new Error(
      "The approved bills allocation cannot preserve the minimum available reserve.",
    );
  }
  const adjustedSavings = Math.min(savings, roundMoney(allocatable - bills));
  return {
    id: randomUUID(),
    personaId: dashboard.persona.id,
    type: "salary_allocation",
    title: "Apply salary allocation",
    status: "awaiting_approval",
    amount: roundMoney(bills + adjustedSavings),
    fee: 0,
    sourceAccountId: dashboard.account.id,
    sourceAccountLabel: `${dashboard.account.name} ${dashboard.account.maskedNumber}`,
    destinationLabel: "Bills and savings accounts",
    fields: [
      { label: "Salary detected", value: formatMoney(salary) },
      { label: "Bills pocket", value: formatMoney(bills) },
      { label: "Move to savings", value: formatMoney(adjustedSavings) },
      {
        label: "Kept available",
        value: formatMoney(salary - bills - adjustedSavings),
      },
    ],
    evidence: [
      {
        title: approvedRule ? "Approved rule applied" : "Default demo rule",
        detail: approvedRule
          ? `Savings: ${savingsInstruction}. Bills: ${billsInstruction}. Minimum available: ${minimumAvailable}.`
          : "No approved customer rule was available, so the disclosed default split was used.",
      },
      {
        title: "Approval required",
        detail: "No allocation is posted until you approve this proposal.",
      },
    ],
    createdAt: new Date().toISOString(),
  } satisfies ActionIntent;
}

function resolveSalaryInstruction(value: string, salary: number) {
  const percent = value.match(/^([\d.]+)% of salary$/i);
  return percent
    ? roundMoney((salary * Number(percent[1])) / 100)
    : parseFormattedMoney(value);
}

function parseFormattedMoney(value: string) {
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
    throw new Error(`Invalid money amount: ${value}`);
  }
  return roundMoney(parsed);
}

export async function prepareSalaryAllocation(
  personaId: string,
  salary: number,
  sessionId = "local-default",
  preferences: SalaryAllocationPreferences = {},
) {
  if (isSqlStoreConfigured()) {
    const dashboard = await sqlGetDashboard(personaId, sessionId);
    return sqlCreateIntent(
      buildSalaryAllocationIntent(dashboard, salary, preferences),
      sessionId,
    );
  }
  return memoryPrepareSalaryAllocation(personaId, salary, sessionId, preferences);
}

export async function prepareBillPayment(
  personaId: string,
  merchant: string,
  amount: number,
  reference?: string,
  dueDate?: string,
  sessionId = "local-default",
) {
  if (isSqlStoreConfigured()) {
    const dashboard = await sqlGetDashboard(personaId, sessionId);
    return sqlCreateIntent(
      buildBillPaymentIntent(dashboard, merchant, amount, reference, dueDate),
      sessionId,
    );
  }
  return memoryPrepareBillPayment(
    personaId,
    merchant,
    amount,
    reference,
    dueDate,
    sessionId,
  );
}

export async function listPendingIntents(
  personaId: string,
  sessionId = "local-default",
) {
  return isSqlStoreConfigured()
    ? sqlListPendingIntents(personaId, sessionId)
    : memoryListPendingIntents(personaId, sessionId);
}

export async function approveIntent(
  personaId: string,
  intentId: string,
  sessionId = "local-default",
) {
  return isSqlStoreConfigured()
    ? sqlApproveIntent(personaId, intentId, sessionId)
    : memoryApproveIntent(personaId, intentId, sessionId);
}

export function resetBankState() {
  globalThis.caldovaBankStates = new Map();
}

export async function resetDemoSession(sessionId: string) {
  if (isSqlStoreConfigured()) {
    await sqlResetDemoSession(sessionId);
  } else {
    globalThis.caldovaBankStates?.delete(sessionId);
  }
}

export function formatMoney(amount: number) {
  return new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency: "UAH",
    minimumFractionDigits: 2,
  })
    .format(amount)
    .replace("грн", "₴")
    .trim();
}

export function localPolicyEvidence(query: string): Evidence[] {
  if (query.toLocaleLowerCase().includes("deposit")) {
    return [
      {
        title: "Safety reserve deposit",
        detail:
          "Synthetic demo offer: flexible access, illustrative 9.5% annual rate.",
        source: "Caldova savings products",
        url: "/knowledge/savings-products",
      },
    ];
  }
  return [];
}
