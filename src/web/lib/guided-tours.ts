export type TourAction =
  | { kind: "prompt"; prompt: string }
  | { kind: "open_account"; accountIndex: number }
  | { kind: "salary_event" }
  | { kind: "focus_voice" }
  | { kind: "focus_upload" }
  | { kind: "focus_reset" };

export type GuidedTourStep = {
  title: string;
  narration: string;
  target: string;
  action?: TourAction;
  actionLabel?: string;
};

export type GuidedTour = {
  id: string;
  title: string;
  category: "Essentials" | "AI transformation";
  summary: string;
  personaId?: string;
  duration: string;
  steps: GuidedTourStep[];
};

const evidenceStep: GuidedTourStep = {
  title: "Inspect what made it true",
  narration:
    "The assistant shows the actual tool trace, source records, calculation method, assumptions, and any approval boundary. The narration never substitutes for evidence in the phone.",
  target: "assistant-evidence",
};

export const guidedTours: GuidedTour[] = [
  {
    id: "accounts",
    title: "Accounts and activity",
    category: "Essentials",
    summary: "Browse a real multi-account customer profile and its transaction history.",
    personaId: "andrii",
    duration: "45 sec",
    steps: [
      {
        title: "A normal bank app first",
        narration:
          "Start with familiar account cards. Balances and six months of activity come from the selected synthetic customer's banking records.",
        target: "account-carousel",
      },
      {
        title: "Open the primary account",
        narration:
          "Open the card to inspect account-specific transactions. This is ordinary banking functionality, not an AI-only prototype.",
        target: "account-carousel",
        action: { kind: "open_account", accountIndex: 0 },
        actionLabel: "Open account",
      },
    ],
  },
  {
    id: "transaction-explanation",
    title: "Explain a transaction",
    category: "Essentials",
    summary: "Turn a transaction question into a grounded explanation.",
    personaId: "oleksii",
    duration: "60 sec",
    steps: [
      {
        title: "Ask from visible activity",
        narration:
          "The assistant receives the selected customer, then searches merchant, category, fee, and transaction notes rather than guessing.",
        target: "recent-activity",
        action: {
          kind: "prompt",
          prompt: "Explain my Scandic Stockholm charge and the related fee.",
        },
        actionLabel: "Ask assistant",
      },
      evidenceStep,
    ],
  },
  {
    id: "mobile-topup",
    title: "Repeat a mobile top-up",
    category: "Essentials",
    summary: "Resolve “same as last time,” prepare an intent, and preserve approval.",
    personaId: "andrii",
    duration: "75 sec",
    steps: [
      {
        title: "Natural language, real history",
        narration:
          "The model must retrieve the last completed top-up before it can reuse the phone and amount.",
        target: "command-input",
        action: {
          kind: "prompt",
          prompt: "Top up my phone with the same amount as last time.",
        },
        actionLabel: "Prepare top-up",
      },
      evidenceStep,
      {
        title: "The customer remains in control",
        narration:
          "The proposal is an approval-bound server-side intent. The tour never presses Approve; only the presenter or customer can do that.",
        target: "approval-card",
      },
    ],
  },
  {
    id: "account-transfer",
    title: "Transfer between accounts",
    category: "Essentials",
    summary:
      "Resolve account names, prepare a governed money movement, and update both balances after approval.",
    personaId: "andrii",
    duration: "75 sec",
    steps: [
      {
        title: "Ask for the outcome naturally",
        narration:
          "The customer names familiar accounts. The model resolves the exact account IDs from verified data rather than asking for internal identifiers.",
        target: "command-input",
        action: {
          kind: "prompt",
          prompt:
            "Move 100 UAH from my Universal account to my Savings jar. Prepare it for my approval.",
        },
        actionLabel: "Prepare transfer",
      },
      {
        title: "Inspect the governed action",
        narration:
          "One reusable money-movement capability validates ownership, currency, balance, and destination before creating an approval-bound intent.",
        target: "assistant-evidence",
      },
      {
        title: "Approve the exact movement",
        narration:
          "The customer sees the source, destination, amount, and fee. Only deliberate approval posts the debit and matching credit.",
        target: "approval-card",
      },
    ],
  },
  {
    id: "salary-event",
    title: "Salary-triggered automation",
    category: "Essentials",
    summary: "Publish a real event and let the worker prepare a bounded proposal.",
    personaId: "andrii",
    duration: "90 sec",
    steps: [
      {
        title: "Banking can start the conversation",
        narration:
          "A synthetic core-banking salary event travels through Azure Service Bus and wakes the worker.",
        target: "salary-event",
        action: { kind: "salary_event" },
        actionLabel: "Trigger salary event",
      },
      {
        title: "Automation is proposed, not imposed",
        narration:
          "The worker writes a session-isolated approval intent. Nothing moves until the customer approves the exact rule.",
        target: "approval-card",
      },
    ],
  },
  {
    id: "invoice",
    title: "Invoice from an image",
    category: "Essentials",
    summary: "Extract invoice fields and prepare—not execute—a payment.",
    personaId: "iryna",
    duration: "60 sec",
    steps: [
      {
        title: "Multimodal input",
        narration:
          "Azure AI Document Intelligence extracts the payee, amount, reference, and due date. A balance check then prepares a payment intent.",
        target: "invoice-upload",
        action: { kind: "focus_upload" },
        actionLabel: "Show upload control",
      },
      {
        title: "A safe stopping point",
        narration:
          "File selection and payment approval always stay with the user; the tour cannot invoke either.",
        target: "command-dock",
      },
    ],
  },
  {
    id: "voice",
    title: "Voice banking",
    category: "Essentials",
    summary: "Transcribe a request, then run it through the same governed agent.",
    personaId: "andrii",
    duration: "45 sec",
    steps: [
      {
        title: "Voice is an input channel",
        narration:
          "Azure AI Speech produces text; after that, the exact same typed tools, evidence, and approval boundaries apply.",
        target: "voice-input",
        action: { kind: "focus_voice" },
        actionLabel: "Show voice control",
      },
    ],
  },
  {
    id: "session-reset",
    title: "Isolated demo reset",
    category: "Essentials",
    summary: "Show immutable base records and browser-isolated demo activity.",
    duration: "30 sec",
    steps: [
      {
        title: "Every presenter gets a clean sandbox",
        narration:
          "Generated transactions, approvals, automations, and banker cases belong only to this browser session. Fixed customer history stays unchanged.",
        target: "reset-demo",
        action: { kind: "focus_reset" },
        actionLabel: "Show reset",
      },
    ],
  },
  {
    id: "relocation-guidance",
    title: "Relocation decision",
    category: "AI transformation",
    summary:
      "Test a future move against visible savings, observed cash flow, and a protected reserve.",
    personaId: "andrii",
    duration: "2 min",
    steps: [
      {
        title: "State an outcome and boundaries",
        narration:
          "This is an example request, not a routed feature. The customer can type any outcome and boundaries here; the model then decides what evidence and tools it needs.",
        target: "command-input",
        action: {
          kind: "prompt",
          prompt:
            "I may relocate to Warsaw in 6 months. The move will cost ₴90,000 and I must keep ₴60,000 untouched as my emergency reserve. Compare realistic paths and do not move money.",
        },
        actionLabel: "Ask assistant",
      },
      {
        title: "Watch the work unfold",
        narration:
          "A concise approach and the real tool calls appear as they happen. The application validates customer quotes, tool arguments, calculations, evidence, and approval boundaries without exposing private chain-of-thought.",
        target: "agent-plan",
      },
      {
        title: "Compare, do not prescribe",
        narration:
          "Deterministic code compares the requested deadline with a history-based pace. The AI explains the tradeoff; the customer chooses whether to change the date, target, or later prepare an action.",
        target: "scenario-comparison",
      },
      evidenceStep,
    ],
  },
  {
    id: "salary-guidance",
    title: "Salary automation",
    category: "AI transformation",
    summary:
      "Turn customer constraints into a reviewable rule, then apply it to a later event.",
    personaId: "andrii",
    duration: "2 min",
    steps: [
      {
        title: "Express policy in ordinary language",
        narration:
          "The agent checks the verified salary and spending context, preserves every stated percentage and reserve constraint, and prepares a machine-readable rule.",
        target: "command-input",
        action: {
          kind: "prompt",
          prompt:
            "When my salary arrives, put 20% into savings, 25% into my bills pocket, and keep at least ₴15,000 available.",
        },
        actionLabel: "Build the rule",
      },
      {
        title: "Follow the live activity",
        narration:
          "The assistant shows a concise approach and each real tool call as it happens. It separates evidence gathering from action preparation and keeps activation behind a human decision.",
        target: "agent-plan",
      },
      {
        title: "Approve the exact rule",
        narration:
          "The approval card contains the exact instructions and calculated amounts. The tour never presses Approve.",
        target: "approval-card",
      },
      {
        title: "Replan on a real event",
        narration:
          "After approval, a later salary event can use the stored percentages against the new verified amount rather than replaying old numbers.",
        target: "salary-event",
      },
    ],
  },
  {
    id: "financial-checkup-guidance",
    title: "Proactive financial checkup",
    category: "AI transformation",
    summary:
      "Combine cash-flow changes, recurring commitments, and resilience into one evidence-backed review.",
    personaId: "iryna",
    duration: "90 sec",
    steps: [
      {
        title: "Ask for an outcome, not a widget",
        narration:
          "A broad checkup requires several reusable analyses. The model decides which evidence is relevant and combines it into one customer-facing explanation.",
        target: "adaptive-insights",
        action: {
          kind: "prompt",
          prompt:
            "Give me a proactive financial checkup: review cash-flow changes, recurring subscriptions, and my essential-spending runway. Explain what deserves attention, but do not change anything.",
        },
        actionLabel: "Run checkup",
      },
      {
        title: "Multiple evidence steps",
        narration:
          "The model chooses and composes relevant analysis tools. The live activity stream makes that work inspectable without turning the internal plan into the main experience.",
        target: "agent-plan",
      },
      evidenceStep,
    ],
  },
  {
    id: "payment-resolution-guidance",
    title: "Suspicious payment resolution",
    category: "AI transformation",
    summary:
      "Investigate observable signals, explain uncertainty, and hand grounded context to a person.",
    personaId: "danylo",
    duration: "90 sec",
    steps: [
      {
        title: "Investigate without declaring fraud",
        narration:
          "The agent checks the actual transaction and transparent warning signals. It cannot invent a risk score or claim certainty.",
        target: "recent-activity",
        action: {
          kind: "prompt",
          prompt:
            "I do not recognize the DIGITALRIVER IE payment. Investigate the observable signals and draft a message informing my advisor because I want a person to review it. Do not block anything.",
        },
        actionLabel: "Start review",
      },
      {
        title: "Prepare the advisor message",
        narration:
          "The live activity shows the model-selected transaction evidence and the exact advisor-message draft. Nothing is sent until the customer deliberately approves the topic and text.",
        target: "agent-plan",
      },
      {
        title: "Make approval deliberate",
        narration:
          "The customer reviews the exact advisor topic and message, then must drag the control across the screen. Clicking cannot send it.",
        target: "approval-screen",
      },
      evidenceStep,
    ],
  },
  {
    id: "goal-constraints-guidance",
    title: "Goal under constraints",
    category: "AI transformation",
    summary:
      "Compare a target with observed capacity while protecting money earmarked for another purpose.",
    personaId: "sofia",
    duration: "90 sec",
    steps: [
      {
        title: "Make constraints explicit",
        narration:
          "Sofia’s tax reserve is visible, but only Sofia can say it must remain protected. The model preserves that constraint instead of silently treating all savings as spendable.",
        target: "command-input",
        action: {
          kind: "prompt",
          prompt:
            "I want a ₴60,000 emergency fund in 12 months, and I must keep my ₴19,650 tax reserve untouched. Compare the requested deadline with a history-based pace.",
        },
        actionLabel: "Compare paths",
      },
      {
        title: "Numbers come from inspectable sources",
        narration:
          "The goal and reserve come from the customer; balances come from accounts; capacity comes from completed transaction months; calculations come from deterministic code.",
        target: "scenario-comparison",
      },
      evidenceStep,
    ],
  },
];

export function findGuidedTour(id: string) {
  return guidedTours.find((tour) => tour.id === id) ?? guidedTours[0];
}
