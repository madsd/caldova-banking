export type PersonaSummary = {
  id: string;
  name: string;
  initials: string;
  descriptor: string;
  advisorName: string;
  advisorInitials: string;
};

export type Transaction = {
  id: string;
  accountId: string;
  merchant: string;
  category: string;
  amount: number;
  currency: "UAH" | "EUR" | "USD";
  bookedAt: string;
  direction: "credit" | "debit";
  note: string;
};

export type BankAccount = {
  id: string;
  name: string;
  maskedNumber: string;
  balance: number;
  currency: "UAH" | "EUR" | "USD";
  type: "current" | "digital" | "savings" | "travel";
  network?: "VISA" | "Mastercard";
};

export type Dashboard = {
  persona: PersonaSummary;
  account: BankAccount;
  accounts: BankAccount[];
  phone: string;
  transactions: Transaction[];
  aiMode: "foundry" | "local-preview";
};

export type SpendingSummary = {
  periodMonths: number;
  monthly: Array<{
    month: string;
    income: number;
    spending: number;
    surplus: number;
  }>;
  averageIncome: number;
  averageSpending: number;
  averageSurplus: number;
  recommendedMonthlySavings: number;
  categories: Array<{
    category: string;
    monthlyAverage: number;
  }>;
  methodology: string;
};

export type Evidence = {
  title: string;
  detail: string;
  source?: string;
  url?: string;
  document?: string;
};

export type FinancialInsightKind =
  | "savings_projection"
  | "goal_plan"
  | "scenario_comparison"
  | "money_radar"
  | "scam_guardian"
  | "life_event"
  | "adaptive_banking"
  | "subscription_optimizer"
  | "resilience_plan";

export type FinancialInsight = {
  kind: FinancialInsightKind;
  title: string;
  summary: string;
  metrics: Array<{ label: string; value: string }>;
  evidence: Evidence[];
  assumptions: string[];
  methodology: string;
  suggestedPrompt?: string;
  priority?: "now" | "soon" | "explore";
  scenarios?: CashScenario[];
};

export type CashScenario = {
  id: string;
  label: string;
  monthlyAmount: number;
  durationMonths: number | null;
  outcome: string;
  tradeoff: string;
};

export type AgentPlan = {
  id: string;
  objective: string;
  status: "active" | "needs_input" | "ready_for_decision" | "completed";
  constraints: string[];
  openQuestions: string[];
  steps: Array<{
    id: string;
    title: string;
    toolName: string | null;
    status: "pending" | "running" | "completed" | "blocked" | "skipped";
  }>;
  evidence: Evidence[];
  scenarios: CashScenario[];
  proposedActions: Array<{
    id: string;
    title: string;
    status: ActionIntent["status"];
  }>;
  updatedAt: string;
};

export const advisorTopics = [
  "Payments and transfers",
  "Cards and security",
  "Accounts and savings",
  "Fees and services",
  "Something else",
] as const;

export type AdvisorTopic = (typeof advisorTopics)[number];

export type AdvisorMessage = {
  id: string;
  personaId: string;
  status: "draft" | "sent";
  topic: AdvisorTopic;
  body: string;
  evidence: Evidence[];
  createdAt: string;
  sentAt?: string;
};

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type ActionIntent = {
  id: string;
  personaId: string;
  type:
    | "mobile_topup"
    | "salary_rule"
    | "salary_allocation"
    | "bill_payment"
    | "account_transfer";
  title: string;
  status:
    | "awaiting_approval"
    | "approved"
    | "completed"
    | "rejected"
    | "failed";
  amount: number;
  fee: number;
  sourceAccountId: string;
  sourceAccountLabel: string;
  destinationAccountId?: string;
  destinationLabel: string;
  fields: Array<{ label: string; value: string }>;
  evidence: Evidence[];
  createdAt: string;
  sourceEventId?: string;
  receipt?: string;
};

export type AgentEvent =
  | { type: "status"; title: string; detail: string }
  | { type: "tool_start"; id: string; name: string; detail: string }
  | { type: "tool_result"; id: string; name: string; detail: string }
  | { type: "message"; text: string; sources?: Evidence[] }
  | { type: "plan"; plan: AgentPlan }
  | { type: "intent"; intent: ActionIntent }
  | { type: "advisor_draft"; message: AdvisorMessage }
  | { type: "error"; message: string }
  | { type: "done"; mode: Dashboard["aiMode"] };
