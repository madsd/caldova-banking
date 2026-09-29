export type BankingCapability = {
  id: string;
  name: string;
  category: "common" | "advanced";
  mode: "read" | "analyze" | "prepare" | "automate" | "escalate";
  description: string;
  approvalRequired: boolean;
  examples: string[];
};

export const bankingCapabilities: BankingCapability[] = [
  {
    id: "account-overview",
    name: "Account overview",
    category: "common",
    mode: "read",
    description:
      "Inspect balances, account details, and recent activity across the customer's accounts.",
    approvalRequired: false,
    examples: [
      "How much money do I have available?",
      "Show activity on my savings account.",
    ],
  },
  {
    id: "transaction-explanation",
    name: "Transaction explanation",
    category: "common",
    mode: "analyze",
    description:
      "Find relevant transactions and explain merchant, category, fee, and note evidence.",
    approvalRequired: false,
    examples: [
      "What was this card charge?",
      "Why did I pay a foreign exchange fee?",
    ],
  },
  {
    id: "money-movement",
    name: "Money movement",
    category: "common",
    mode: "prepare",
    description:
      "Prepare own-account transfers, mobile top-ups, and bill payments through one governed action contract.",
    approvalRequired: true,
    examples: [
      "Move ₴100 from Universal to my Savings jar.",
      "Top up my phone with the same amount as last time.",
      "Pay this utility bill.",
    ],
  },
  {
    id: "product-policy-help",
    name: "Product and policy help",
    category: "common",
    mode: "read",
    description:
      "Ground answers about products, fees, limits, eligibility, and banking procedures in controlled sources.",
    approvalRequired: false,
    examples: [
      "What is the top-up limit?",
      "Which account is suitable for travel?",
    ],
  },
  {
    id: "advisor-handoff",
    name: "Advisor handoff",
    category: "common",
    mode: "escalate",
    description:
      "Prepare a grounded message for a human advisor without sending it until the customer approves.",
    approvalRequired: true,
    examples: [
      "Tell my advisor I do not recognize this transaction.",
      "Ask my advisor about changing my account.",
    ],
  },
  {
    id: "salary-automation",
    name: "Salary automation",
    category: "advanced",
    mode: "automate",
    description:
      "Turn natural-language allocation constraints into a reviewable rule that can react to future salary events.",
    approvalRequired: true,
    examples: [
      "When salary arrives, save 20%, reserve 25% for bills, and keep ₴15,000 available.",
    ],
  },
  {
    id: "goal-planning",
    name: "Goal and life-event planning",
    category: "advanced",
    mode: "analyze",
    description:
      "Compare customer-defined goals and deadlines with visible savings, protected reserves, and observed cash-flow capacity.",
    approvalRequired: false,
    examples: [
      "Can I afford to relocate in six months without touching my emergency fund?",
      "Compare realistic paths to my savings goal.",
    ],
  },
  {
    id: "proactive-financial-review",
    name: "Proactive financial review",
    category: "advanced",
    mode: "analyze",
    description:
      "Combine spending changes, recurring commitments, savings capacity, and cash runway into an evidence-backed review.",
    approvalRequired: false,
    examples: [
      "Give me a financial checkup.",
      "What deserves my attention this month?",
    ],
  },
  {
    id: "suspicious-payment-review",
    name: "Suspicious payment review",
    category: "advanced",
    mode: "analyze",
    description:
      "Investigate observable transaction signals, explain uncertainty, and optionally prepare a human escalation.",
    approvalRequired: false,
    examples: [
      "I do not recognize this merchant.",
      "Check this payment and help me escalate it.",
    ],
  },
  {
    id: "event-driven-proposals",
    name: "Event-driven proposals",
    category: "advanced",
    mode: "automate",
    description:
      "React to verified banking events by preparing bounded proposals rather than silently changing customer finances.",
    approvalRequired: true,
    examples: [
      "Apply my approved allocation rule when my next salary arrives.",
    ],
  },
];

export function listBankingCapabilities() {
  return bankingCapabilities.map((capability) => ({
    ...capability,
    examples: [...capability.examples],
  }));
}
