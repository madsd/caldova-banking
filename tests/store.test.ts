import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { POST as submitDemoKey } from "@/app/api/access/route";
import {
  extractToolEvidence,
  knowledgeDocumentEvidence,
  resolveSalaryAmount,
  runBankingAgent,
  shouldRecheckCapabilityBoundary,
} from "@/lib/agent";
import {
  addPlanEvidence,
  applyAgentPlanUpdate,
  reconcileAgentPlan,
  updatePlanStep,
} from "@/lib/agent-plan";
import {
  getDemoSessionToken,
  hashDemoKey,
  hasValidDemoSession,
  isValidDemoKey,
} from "@/lib/demo-access";
import { createBalancedPostings } from "@/lib/ledger";
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
import { listBankingCapabilities } from "@/lib/banking-capabilities";
import { guidedTours } from "@/lib/guided-tours";
import {
  approveIntent,
  calculateSpendingSummary,
  formatMoney,
  getDashboard,
  listAdvisorMessages,
  prepareAccountTransfer,
  prepareBillPayment,
  prepareAdvisorMessage,
  prepareMoneyMovement,
  prepareMobileTopup,
  prepareSalaryAllocation,
  prepareSalaryEventAllocation,
  resetBankState,
  resetDemoSession,
  sendAdvisorMessage,
} from "@/lib/store";
import type { Dashboard, Transaction } from "@/lib/types";
import {
  buildSalaryAllocation,
  parseApprovedRule,
} from "../src/worker/src/salary-allocation";

describe("customer-visible grounding", () => {
  it("carries the exact indexed demo guide alongside its retrieved excerpt", () => {
    const content = readFileSync("knowledge/mobile-top-ups.md", "utf8");
    const source = knowledgeDocumentEvidence({
      title: "Mobile top-ups",
      content,
      sourceUrl: "/knowledge/mobile-top-ups.md",
    });

    expect(source).toEqual({
      title: "Mobile top-ups",
      detail: content.slice(0, 320),
      source: "Caldova policy knowledge",
      url: "/knowledge/mobile-top-ups.md",
      document: content,
    });
    expect(source.document).toContain("The demo daily limit is UAH 5,000.");
  });

  it("persists guide excerpts rather than full documents in the agent plan", () => {
    const source = knowledgeDocumentEvidence({
      title: "Mobile top-ups",
      content: readFileSync("knowledge/mobile-top-ups.md", "utf8"),
      sourceUrl: "/knowledge/mobile-top-ups.md",
    });
    expect(extractToolEvidence("search_products_and_policies", [source])).toEqual([
      {
        title: source.title,
        detail: source.detail,
        source: source.source,
        url: source.url,
      },
    ]);
  });

  it("extracts customer account facts independently of retrieved guides", () => {
    expect(
      extractToolEvidence("get_account_snapshot", {
        accounts: [
          { balance: 1200, currency: "UAH", type: "current" },
          { balance: 750, currency: "UAH", type: "savings" },
        ],
      }),
    ).toEqual([
      {
        title: "Visible account context",
        detail: expect.stringContaining("750"),
        source: "Account balances",
      },
    ]);
  });
});

describe("approval boundary", () => {
  beforeEach(() => {
    delete process.env.SQL_SERVER;
    delete process.env.SQL_DATABASE;
    delete process.env.FOUNDRY_PROJECT_ENDPOINT;
    delete process.env.DEMO_PUBLIC_ORIGIN;
    resetBankState();
  });

  it("executes an approved top-up exactly once", async () => {
    const before = await getDashboard("andrii");
    const intent = await prepareMobileTopup("andrii", 250);
    const result = await approveIntent("andrii", intent.id);

    expect(result.intent.status).toBe("completed");
    expect(result.dashboard.account.balance).toBe(
      before.account.balance - intent.amount - intent.fee,
    );
    await expect(approveIntent("andrii", intent.id)).rejects.toThrow(
      /cannot be approved/,
    );
  });

  it("provisions ledger accounts for every customer account", () => {
    const schema = readFileSync("scripts/schema.sql", "utf8");

    expect(schema).toContain("CONCAT('CUSTOMER-LIABILITY:', id)");
    expect(schema).toMatch(/FROM accounts\s*\)\s+AS source/);
  });

  it("rejects approval from another customer", async () => {
    const intent = await prepareMobileTopup("andrii", 250);
    await expect(approveIntent("iryna", intent.id)).rejects.toThrow(
      /not found/,
    );
  });

  it("prepares invoice payments without executing them", async () => {
    const before = await getDashboard("andrii");
    const intent = await prepareBillPayment(
      "andrii",
      "Caldova Utilities",
      1250,
      "INV-42",
    );
    const after = await getDashboard("andrii");

    expect(intent.type).toBe("bill_payment");
    expect(intent.status).toBe("awaiting_approval");
    expect(after.account.balance).toBe(before.account.balance);
  });

  it("uses the current account balance as proposal evidence", async () => {
    const topup = await prepareMobileTopup("andrii", 250);
    await approveIntent("andrii", topup.id);
    const dashboard = await getDashboard("andrii");
    const invoice = await prepareBillPayment(
      "andrii",
      "Caldova Utilities",
      1250,
    );

    expect(invoice.evidence).toContainEqual({
      title: "Balance checked",
      detail: `${formatMoney(dashboard.account.balance)} is available before payment.`,
    });
  });

  it("approves a salary plan without treating it as a payment", async () => {
    const before = await getDashboard("andrii");
    const intent = await prepareSalaryAllocation("andrii", 42800);
    const result = await approveIntent("andrii", intent.id);

    expect(intent.type).toBe("salary_rule");
    expect(result.intent.status).toBe("completed");
    expect(result.dashboard.account.balance).toBe(before.account.balance);
  });

  it("applies an approved salary rule to a later event and moves the allocation", async () => {
    const rule = await prepareSalaryAllocation("andrii", 42_800, undefined, {
      savingsPercent: 20,
      billsPercent: 25,
      minimumAvailable: 15_000,
    });
    await approveIntent("andrii", rule.id);
    const beforeEvent = await getDashboard("andrii");

    const allocation = await prepareSalaryEventAllocation("andrii", 42_800);
    expect(allocation.type).toBe("salary_allocation");
    expect(allocation.amount).toBe(19_260);

    const result = await approveIntent("andrii", allocation.id);
    const main = result.dashboard.accounts.find(
      (account) => account.id === "acc-andrii-main",
    )!;
    const bills = result.dashboard.accounts.find(
      (account) => account.id === "acc-andrii-digital",
    )!;
    const savings = result.dashboard.accounts.find(
      (account) => account.id === "acc-andrii-savings",
    )!;
    expect(main.balance).toBe(beforeEvent.account.balance + 42_800 - 19_260);
    expect(bills.balance).toBe(
      beforeEvent.accounts.find(
        (account) => account.id === "acc-andrii-digital",
      )!.balance + 10_700,
    );
    expect(savings.balance).toBe(
      beforeEvent.accounts.find(
        (account) => account.id === "acc-andrii-savings",
      )!.balance + 8_560,
    );
  });

  it("rejects oversized top-ups before presenting an approval", async () => {
    await expect(prepareMobileTopup("andrii", 5_001)).rejects.toThrow(
      /daily limit/,
    );
  });

  it("moves money between the customer's own accounts after approval", async () => {
    const before = await getDashboard("andrii");
    const source = before.accounts.find(
      (account) => account.id === "acc-andrii-main",
    )!;
    const destination = before.accounts.find(
      (account) => account.id === "acc-andrii-savings",
    )!;
    const intent = await prepareAccountTransfer(
      "andrii",
      source.id,
      destination.id,
      100,
    );

    const prepared = await getDashboard("andrii");
    expect(intent.type).toBe("account_transfer");
    expect(intent.status).toBe("awaiting_approval");
    expect(
      prepared.accounts.find((account) => account.id === source.id)?.balance,
    ).toBe(source.balance);
    expect(
      prepared.accounts.find((account) => account.id === destination.id)
        ?.balance,
    ).toBe(destination.balance);

    const result = await approveIntent("andrii", intent.id);
    expect(
      result.dashboard.accounts.find((account) => account.id === source.id)
        ?.balance,
    ).toBe(source.balance - 100);
    expect(
      result.dashboard.accounts.find(
        (account) => account.id === destination.id,
      )?.balance,
    ).toBe(destination.balance + 100);
  });

  it("rejects transfers to an account not owned by the customer", async () => {
    await expect(
      prepareAccountTransfer(
        "andrii",
        "acc-andrii-main",
        "acc-iryna-savings",
        100,
      ),
    ).rejects.toThrow(/belong to this customer/);
  });

  it("prepares different payment rails through one money movement contract", async () => {
    const dashboard = await getDashboard("andrii");
    const sourceAccountId = dashboard.account.id;

    const transfer = await prepareMoneyMovement("andrii", {
      kind: "own_account_transfer",
      sourceAccountId,
      destinationAccountId: "acc-andrii-savings",
      amount: 100,
    });
    const topup = await prepareMoneyMovement("andrii", {
      kind: "mobile_topup",
      sourceAccountId,
      phone: dashboard.phone,
      amount: 200,
    });
    const bill = await prepareMoneyMovement("andrii", {
      kind: "bill_payment",
      sourceAccountId,
      payee: "Caldova Utilities",
      amount: 300,
      reference: "INV-300",
    });

    expect(transfer.type).toBe("account_transfer");
    expect(topup.type).toBe("mobile_topup");
    expect(bill.type).toBe("bill_payment");
    expect(
      [transfer, topup, bill].every(
        (intent) => intent.status === "awaiting_approval",
      ),
    ).toBe(true);
    expect(topup.evidence.some((item) => item.title === "History matched")).toBe(
      false,
    );
    expect(
      bill.evidence.some((item) => item.title === "Invoice understood"),
    ).toBe(false);
  });
});

describe("capability discovery", () => {
  it("publishes common and advanced use cases with approval boundaries", () => {
    const capabilities = listBankingCapabilities();

    expect(
      capabilities.some(
        (capability) =>
          capability.category === "common" &&
          capability.id === "money-movement" &&
          capability.approvalRequired,
      ),
    ).toBe(true);
    expect(
      capabilities.some(
        (capability) =>
          capability.category === "advanced" &&
          capability.mode === "analyze",
      ),
    ).toBe(true);
    expect(
      capabilities.some(
        (capability) =>
          capability.category === "advanced" &&
          capability.mode === "automate" &&
          capability.approvalRequired,
      ),
    ).toBe(true);
  });
});

describe("browser session isolation", () => {
  const sessionA = "11111111-1111-4111-8111-111111111111";
  const sessionB = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    delete process.env.SQL_SERVER;
    delete process.env.SQL_DATABASE;
    resetBankState();
  });

  it("keeps prepared and completed actions private to one browser session", async () => {
    const base = await getDashboard("andrii", sessionB);
    const intent = await prepareMobileTopup(
      "andrii",
      250,
      undefined,
      sessionA,
    );

    await expect(
      approveIntent("andrii", intent.id, sessionB),
    ).rejects.toThrow(/not found/);

    const completed = await approveIntent("andrii", intent.id, sessionA);
    const otherBrowser = await getDashboard("andrii", sessionB);

    expect(completed.dashboard.account.balance).toBe(
      base.account.balance - intent.amount - intent.fee,
    );
    expect(otherBrowser.account.balance).toBe(base.account.balance);
    expect(otherBrowser.transactions).toHaveLength(base.transactions.length);
  });

  it("resets only the caller while preserving another browser's activity", async () => {
    const base = await getDashboard("andrii", sessionA);
    const intentA = await prepareMobileTopup(
      "andrii",
      250,
      undefined,
      sessionA,
    );
    const intentB = await prepareMobileTopup(
      "andrii",
      400,
      undefined,
      sessionB,
    );
    await approveIntent("andrii", intentA.id, sessionA);
    await approveIntent("andrii", intentB.id, sessionB);

    await resetDemoSession(sessionA);

    expect((await getDashboard("andrii", sessionA)).account.balance).toBe(
      base.account.balance,
    );
    expect((await getDashboard("andrii", sessionB)).account.balance).toBe(
      base.account.balance - intentB.amount - intentB.fee,
    );
  });
});

describe("ledger postings", () => {
  it("produces equal debit and credit totals", () => {
    const postings = createBalancedPostings(250, 2.5);
    const debit = postings
      .filter((item) => item.direction === "debit")
      .reduce((sum, item) => sum + item.amount, 0);
    const credit = postings
      .filter((item) => item.direction === "credit")
      .reduce((sum, item) => sum + item.amount, 0);

    expect(debit).toBe(credit);
  });
});

describe("model-authored planning", () => {
  it("rechecks model refusals against the capability registry", () => {
    expect(
      shouldRecheckCapabilityBoundary(
        "I can help prepare it, but I can’t execute transfers.",
      ),
    ).toBe(true);
    expect(
      shouldRecheckCapabilityBoundary(
        "The transfer is ready for your review and approval.",
      ),
    ).toBe(false);
  });

  it("has no application-side keyword mission router", () => {
    const source = readFileSync("src/web/lib/agent.ts", "utf8");
    expect(source).not.toMatch(/inferMission|missionSteps|toolPlanStep/);
    expect(source).not.toMatch(/normalized\.includes\(["']relocat/);
    expect(source).toContain('name: "update_agent_plan"');
    expect(source).toContain('name: "list_banking_capabilities"');
    expect(source).toContain('name: "prepare_money_movement"');
    expect(source).not.toContain('name: "prepare_account_transfer"');
    expect(source).toMatch(
      /Never carry constraints from an unrelated\s+objective into the current request\./,
    );
    expect(source).not.toContain(
      "Agent Plan state (preserve this objective and constraints",
    );
  });

  it("does not replace the Foundry model with local keyword routing", async () => {
    const events: Array<Parameters<Parameters<typeof runBankingAgent>[2]>[0]> =
      [];
    await runBankingAgent(
      "andrii",
      "I may relocate in six months and want help deciding what to do.",
      async (event) => {
        events.push(event);
      },
    );

    expect(events.at(-1)).toEqual({ type: "done", mode: "local-preview" });
    expect(events.some((event) => event.type === "tool_start")).toBe(false);
    expect(events.some((event) => event.type === "intent")).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === "message" &&
          /will not imitate the agent with hardcoded request matching/i.test(
            event.text,
          ),
      ),
    ).toBe(true);
  });

  it("accepts an arbitrary model-authored plan without a mission category", () => {
    const customerMessage =
      "Help me understand whether a move next spring is realistic, but keep ₴60,000 untouched.";
    const plan = applyAgentPlanUpdate(
      null,
      {
        operation: "create",
        objective: "Assess the customer's options for a move next spring",
        status: "active",
        constraints: [
          "keep ₴60,000 untouched",
          "assume a six-month deadline",
        ],
        openQuestions: [],
        steps: [
          {
            id: "inspect-balances",
            title: "Inspect available balances",
            toolName: "get_account_snapshot",
            status: "pending",
          },
          {
            id: "ask-timing",
            title: "Clarify the exact timing",
            toolName: null,
            status: "pending",
          },
        ],
      },
      [customerMessage],
    );
    expect(plan).not.toHaveProperty("mission");
    expect(plan.constraints).toEqual(["keep ₴60,000 untouched"]);
    expect(plan.steps.map((step) => step.id)).toEqual([
      "inspect-balances",
      "ask-timing",
    ]);
  });

  it("tracks whichever tool step the model authored and validates readiness", () => {
    const initial = applyAgentPlanUpdate(
      null,
      {
        operation: "create",
        objective: "Compare options",
        status: "ready_for_decision",
        constraints: [],
        openQuestions: [],
        steps: [
          {
            id: "review-history",
            title: "Review transaction history",
            toolName: "search_transactions",
            status: "pending",
          },
        ],
      },
      ["Compare my options."],
    );
    expect(initial.status).toBe("active");

    const completed = addPlanEvidence(
      updatePlanStep(initial, "review-history", "completed"),
      [
        {
          title: "Verified activity",
          detail: "Transaction history checked.",
          source: "Transactions",
        },
      ],
    );
    const ready = applyAgentPlanUpdate(
      completed,
      {
        operation: "update",
        objective: completed.objective,
        status: "ready_for_decision",
        constraints: [],
        openQuestions: [],
        steps: completed.steps,
      },
      ["Compare my options."],
    );
    expect(ready.status).toBe("ready_for_decision");
    expect(ready.id).toBe(initial.id);
    expect(ready.steps[0].status).toBe("completed");
  });

  it("reconciles a grounded model plan without mission-specific readiness rules", () => {
    const initial = applyAgentPlanUpdate(
      null,
      {
        operation: "create",
        objective: "Answer an arbitrary multi-step banking question",
        status: "active",
        constraints: [],
        openQuestions: [],
        steps: [
          {
            id: "inspect-data",
            title: "Inspect relevant customer data",
            toolName: "get_account_snapshot",
            status: "completed",
          },
        ],
      },
      ["Help me understand my options."],
    );
    const grounded = addPlanEvidence(initial, [
      {
        title: "Verified balance",
        detail: "Account balance retrieved.",
        source: "Account balances",
      },
    ]);

    expect(reconcileAgentPlan(grounded).status).toBe("ready_for_decision");
  });

  it("preserves validated constraints and prior steps across later plan updates", () => {
    const initial = applyAgentPlanUpdate(
      null,
      {
        operation: "create",
        objective: "Evaluate an open-ended customer decision",
        status: "active",
        constraints: ["keep ₴60,000 untouched"],
        openQuestions: [],
        steps: [
          {
            id: "inspect-balance",
            title: "Inspect the current balance",
            toolName: "get_account_snapshot",
            status: "completed",
          },
        ],
      },
      ["Please keep ₴60,000 untouched."],
    );
    const updated = applyAgentPlanUpdate(
      initial,
      {
        operation: "update",
        objective: initial.objective,
        status: "active",
        constraints: [],
        openQuestions: [],
        steps: [
          {
            id: "compare-options",
            title: "Compare the available options",
            toolName: "compare_cash_scenarios",
            status: "pending",
          },
        ],
      },
      ["What should I consider next?"],
    );

    expect(updated.constraints).toEqual(["keep ₴60,000 untouched"]);
    expect(updated.steps.map((step) => step.id)).toEqual([
      "inspect-balance",
      "compare-options",
    ]);
  });

  describe("grounded financial intelligence", () => {
    let dashboard: Dashboard;
    let transactions: Transaction[];

    beforeEach(async () => {
      delete process.env.SQL_SERVER;
      delete process.env.SQL_DATABASE;
      resetBankState();
      dashboard = await getDashboard("danylo");
      transactions = [
        ...dashboard.transactions,
        ...Array.from({ length: 6 }, (_, index) => {
          const month = String(index + 3).padStart(2, "0");
          return [
            {
              id: `salary-${month}`,
              accountId: dashboard.account.id,
              merchant: "Salary",
              category: "Incoming payment",
              amount: 47000,
              currency: "UAH",
              bookedAt: `2026-${month}-02T08:00:00Z`,
              direction: "credit",
              note: "Monthly salary",
            },
            {
              id: `housing-${month}`,
              accountId: dashboard.account.id,
              merchant: "Home loan payment",
              category: "Housing",
              amount: 14000,
              currency: "UAH",
              bookedAt: `2026-${month}-05T08:00:00Z`,
              direction: "debit",
              note: "Monthly mortgage payment",
            },
            {
              id: `groceries-${month}`,
              accountId: dashboard.account.id,
              merchant: "Silpo",
              category: "Groceries",
              amount: 3200 + index * 100,
              currency: "UAH",
              bookedAt: `2026-${month}-12T08:00:00Z`,
              direction: "debit",
              note: "Monthly groceries",
            },
            {
              id: `spotify-${month}`,
              accountId: dashboard.accounts[1].id,
              merchant: "Spotify",
              category: "Subscriptions",
              amount: index < 4 ? 149 : 199,
              currency: "UAH",
              bookedAt: `2026-${month}-22T08:00:00Z`,
              direction: "debit",
              note: "Monthly music subscription",
            },
          ] satisfies Transaction[];
        }).flat(),
      ];
      dashboard = { ...dashboard, transactions };
    });

    it("builds savings projections and goal plans from visible balances and completed months", () => {
      const summary = calculateSpendingSummary(
        transactions,
        new Date("2026-09-03T00:00:00Z"),
      );
      const projection = buildSavingsProjection(dashboard, summary, 3000, 12);
      const goal = buildGoalPlan(
        dashboard,
        summary,
        120000,
        18,
        "Emergency fund",
      );
      const scenarios = buildCashScenarioComparison(
        dashboard,
        summary,
        "Relocation",
        90000,
        12,
        60000,
      );

      expect(projection.kind).toBe("savings_projection");
      expect(projection.metrics).toContainEqual({
        label: "Monthly plan",
        value: expect.stringContaining("3"),
      });
      expect(projection.assumptions).toContain(
        "No interest, inflation, or market return is assumed.",
      );
      expect(goal.kind).toBe("goal_plan");
      expect(goal.evidence.some((item) => item.source === "Customer request")).toBe(
        true,
      );
      expect(scenarios.scenarios).toHaveLength(2);
      expect(scenarios.evidence).toContainEqual(
        expect.objectContaining({ source: "Customer request" }),
      );
    });

    it("detects cash-flow, payment, subscription, and resilience signals without opaque scores", () => {
      const summary = calculateSpendingSummary(
        transactions,
        new Date("2026-09-03T00:00:00Z"),
      );
      const radar = buildMoneyRadar(dashboard, summary);
      const guardian = buildScamGuardian(dashboard, "DIGITALRIVER");
      const subscriptions = buildSubscriptionReview(dashboard);
      const resilience = buildResiliencePlan(dashboard, summary);

      expect(radar.methodology).toMatch(/completed month/i);
      expect(guardian.metrics).toContainEqual({
        label: "Observable signals",
        value: "3",
      });
      expect(guardian.summary).toMatch(/not a fraud verdict/i);
      expect(subscriptions.metrics).toContainEqual({
        label: "Repeated services",
        value: "1",
      });
      expect(subscriptions.metrics[0]).toEqual({
        label: "Monthly total",
        value: expect.stringMatching(/199/),
      });
      expect(subscriptions.evidence[0].detail).toMatch(/earlier-month average/i);
      expect(resilience.metrics.find((item) => item.label === "Coverage")?.value).toMatch(
        /months/,
      );
    });

    it("builds customer-declared life-event plans and explainable adaptive priorities", () => {
      const summary = calculateSpendingSummary(
        transactions,
        new Date("2026-09-03T00:00:00Z"),
      );
      const event = buildLifeEventPlan(
        dashboard,
        summary,
        "Relocation",
        90000,
        12,
      );
      const adaptive = buildAdaptiveInsights(
        {
          ...dashboard,
          transactions: dashboard.transactions.filter(
            (transaction) =>
              !/card-not-present|merchant of record/i.test(transaction.note),
          ),
        },
        summary,
      );

      expect(event.kind).toBe("life_event");
      expect(event.title).toBe("Relocation readiness plan");
      expect(adaptive).toHaveLength(3);
      expect(adaptive.every((insight) => insight.evidence.length > 0)).toBe(true);
      expect(adaptive.every((insight) => insight.suggestedPrompt)).toBe(true);
      expect(adaptive.find((insight) => insight.title === "Your recurring subscriptions")?.suggestedPrompt).toBe(
        "Review my subscriptions and show any price changes.",
      );
      expect(adaptive.find((insight) => insight.title === "Your cash cushion")?.suggestedPrompt).toBe(
        "Show my financial resilience plan.",
      );
    });

    it("persists advisor drafts per browser session and sends only after approval", async () => {
      const sessionA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const sessionB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      const evidence = [
        {
          title: "Visible payment",
          detail: "DIGITALRIVER IE · 899.00 UAH · 2026-08-29",
          source: "txn-digitalriver",
        },
      ];
      const draft = await prepareAdvisorMessage(
        "danylo",
        "Cards and security",
        "Please review the DIGITALRIVER IE payment. I do not recognize it.",
        evidence,
        sessionA,
      );

      expect(draft.status).toBe("draft");
      expect(draft.evidence).toEqual(evidence);
      expect(await listAdvisorMessages("danylo", sessionA)).toHaveLength(1);
      expect(await listAdvisorMessages("danylo", sessionB)).toHaveLength(0);

      await expect(
        sendAdvisorMessage("danylo", draft.id, sessionB),
      ).rejects.toThrow(/not found/);
      const sent = await sendAdvisorMessage("danylo", draft.id, sessionA);
      expect(sent.status).toBe("sent");
      await expect(
        sendAdvisorMessage("danylo", draft.id, sessionA),
      ).rejects.toThrow(/already sent/);

      await resetDemoSession(sessionA);
      expect(await listAdvisorMessages("danylo", sessionA)).toHaveLength(0);
    });

    it("does not use regex routing to choose advisor evidence", () => {
      const source = readFileSync("src/web/lib/store.ts", "utf8");
      const sqlSource = readFileSync("src/web/lib/sql-store.ts", "utf8");
      const schema = readFileSync("scripts/schema.sql", "utf8");
      expect(source).not.toContain("relevantHandoffInsight");
      expect(source).not.toMatch(/fraud\|scam\|suspicious\|payment\|charge/);
      expect(sqlSource).toContain("advisor_messages");
      expect(schema).toContain("CREATE TABLE advisor_messages");
    });
  });

  describe("guided tour catalog", () => {
    it("contains eight essential tours and five open-ended AI journeys", () => {
      expect(
        guidedTours.filter((tour) => tour.category === "Essentials"),
      ).toHaveLength(8);
      expect(
        guidedTours.filter((tour) => tour.category === "AI transformation"),
      ).toHaveLength(5);
      expect(new Set(guidedTours.map((tour) => tour.id)).size).toBe(
        guidedTours.length,
      );
    });

    it("keeps every step actionable, authored, and unable to approve payments", () => {
      const allowedTargets = new Set([
        "account-carousel",
        "recent-activity",
        "command-input",
        "assistant-evidence",
        "approval-card",
        "approval-screen",
        "salary-event",
        "invoice-upload",
        "command-dock",
        "voice-input",
        "reset-demo",
        "adaptive-insights",
        "agent-plan",
        "scenario-comparison",
        "capability-showcase",
      ]);
      const actions = guidedTours.flatMap((tour) =>
        tour.steps.flatMap((step) => (step.action ? [step.action.kind] : [])),
      );

      for (const tour of guidedTours) {
        expect(tour.steps.length).toBeGreaterThan(0);
        for (const step of tour.steps) {
          expect(step.title).not.toBe("");
          expect(step.narration).not.toBe("");
          expect(allowedTargets.has(step.target)).toBe(true);
        }
      }
      expect(actions).not.toContain("approve");
      expect(
        guidedTours.flatMap((tour) =>
          tour.steps.filter((step) => step.action?.kind === "prompt"),
        ),
      ).not.toContainEqual(
        expect.objectContaining({ target: "prompt-suggestions" }),
      );
    });

    it("stages guided prompts for review instead of submitting them", () => {
      const source = readFileSync(
        "src/web/components/BankingExperience.tsx",
        "utf8",
      );
      expect(source).toContain("setInput(action.prompt)");
      expect(source).not.toContain("await sendMessage(action.prompt)");
      expect(source).toContain('"Copy prompt to input"');
      expect(source).toContain("currentTour.stepIndex === stagedPrompt.stepIndex");
      expect(source).toContain("moveTour(1)");
      expect(source).toMatch(/tourPromptStaged\s*\?\s*"command-input"/);
      expect(source).toContain(
        'activeTourStep.action.kind === "salary_event"',
      );
    });

    it("keeps slider gestures isolated from phone scrolling", () => {
      const source = readFileSync(
        "src/web/components/BankingExperience.tsx",
        "utf8",
      );
      expect(source).toContain("function cancelSlide");
      expect(source).toContain("onPointerCancel={cancelSlide}");
      expect(source).toContain("event.stopPropagation()");
    });
  });

  describe("demo access gate", () => {
    beforeEach(async () => {
      process.env.DEMO_ACCESS_KEY_HASH = await hashDemoKey("CaldovaDemoKey");
    });

    it("accepts the demo key case-insensitively", async () => {
      await expect(isValidDemoKey("caldovademokey")).resolves.toBe(true);
      await expect(isValidDemoKey(" CALDOVADEMOKEY ")).resolves.toBe(true);
      await expect(isValidDemoKey("CaldovaNope")).resolves.toBe(false);
    });

    it("recognizes only the derived HTTP-only session value", async () => {
      await expect(
        hasValidDemoSession(await getDemoSessionToken()),
      ).resolves.toBe(true);
      await expect(hasValidDemoSession("forged")).resolves.toBe(false);
    });

    it("redirects to the forwarded public host after key submission", async () => {
      const form = new URLSearchParams({ demoKey: "caldovademokey" });
      const response = await submitDemoKey(
        new Request("http://localhost:3000/api/access", {
          method: "POST",
          body: form,
          headers: {
            "x-forwarded-host": "demo.example.com",
            "x-forwarded-proto": "https",
          },
        }),
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "https://demo.example.com/",
      );
      expect(response.headers.get("set-cookie")).toContain(
        "caldova_demo_access=",
      );
      expect(response.headers.get("set-cookie")).toContain(
        "caldova_demo_session=",
      );
    });

    it("prefers the configured public origin behind a reverse proxy", async () => {
      process.env.DEMO_PUBLIC_ORIGIN = "https://bank.example.com";
      const response = await submitDemoKey(
        new Request("http://localhost:3000/api/access", {
          method: "POST",
          body: new URLSearchParams({ demoKey: "CALDOVADEMOKEY" }),
        }),
      );

      expect(response.headers.get("location")).toBe(
        "https://bank.example.com/",
      );
    });
  });

  describe("salary planning", () => {
    beforeEach(() => {
      delete process.env.SQL_SERVER;
      delete process.env.SQL_DATABASE;
      resetBankState();
    });

    it("uses a verified recent salary when the model omits or guesses zero", async () => {
      const dashboard = await getDashboard("andrii");

      expect(resolveSalaryAmount(null, dashboard.transactions)).toBe(42800);
      expect(resolveSalaryAmount(0, dashboard.transactions)).toBe(42800);
      expect(resolveSalaryAmount(50000, dashboard.transactions)).toBe(50000);
    });

    it("applies explicit allocation percentages instead of fixed ratios", async () => {
      const conservative = await prepareSalaryAllocation(
        "andrii",
        50_000,
        "local-default",
        {
          savingsPercent: 10,
          billsPercent: 35,
          minimumAvailable: 15_000,
        },
      );
      const ambitious = await prepareSalaryAllocation(
        "andrii",
        50_000,
        "local-default",
        {
          savingsPercent: 40,
          billsPercent: 10,
          minimumAvailable: 10_000,
        },
      );

      expect(conservative.fields).toContainEqual({
        label: "Safety reserve",
        value: formatMoney(5_000),
      });
      expect(conservative.fields).toContainEqual({
        label: "Bills pocket",
        value: formatMoney(17_500),
      });
      expect(ambitious.fields).toContainEqual({
        label: "Safety reserve",
        value: formatMoney(20_000),
      });
      expect(ambitious.fields).toContainEqual({
        label: "Bills pocket",
        value: formatMoney(5_000),
      });
    });

    it("caps savings visibly when needed to preserve the requested reserve", async () => {
      const intent = await prepareSalaryAllocation(
        "andrii",
        50_000,
        "local-default",
        {
          savingsAmount: 30_000,
          billsAmount: 15_000,
          minimumAvailable: 10_000,
        },
      );

      expect(intent.fields).toContainEqual({
        label: "Safety reserve",
        value: formatMoney(25_000),
      });
      expect(intent.evidence).toContainEqual({
        title: "Savings adjusted",
        detail: `The requested ${formatMoney(30_000)} was capped at ${formatMoney(25_000)} to preserve the available reserve.`,
      });
    });

    it("applies the approved allocation rule to a later salary event", () => {
      const rule = parseApprovedRule(
        JSON.stringify([
          { label: "Salary detected", value: "42 800,00 ₴" },
          { label: "Savings instruction", value: "20% of salary" },
          { label: "Bills pocket", value: "10 700,00 ₴" },
          { label: "Safety reserve", value: "8 560,00 ₴" },
          { label: "Bills instruction", value: "25% of salary" },
          { label: "Minimum left available", value: "15 000,00 ₴" },
          { label: "Available after plan", value: "23 540,00 ₴" },
        ]),
      );
      const allocation = buildSalaryAllocation(50_000, rule);

      expect(allocation.fields).toContainEqual({
        label: "Move to savings",
        value: "₴10,000",
      });
      expect(allocation.fields).toContainEqual({
        label: "Bills pocket",
        value: "₴12,500",
      });
      expect(allocation.evidence[0]?.title).toBe("Approved rule applied");
    });

    it("derives a bounded savings recommendation from completed months", async () => {
      const dashboard = await getDashboard("andrii");
      const summary = calculateSpendingSummary(
        dashboard.transactions,
        new Date("2026-09-03T00:00:00Z"),
      );

      expect(summary.periodMonths).toBe(6);
      expect(summary.monthly.at(-1)?.month).toBe("2026-08");
      expect(summary.averageIncome).toBeGreaterThan(0);
      expect(summary.recommendedMonthlySavings).toBeGreaterThan(0);
      expect(summary.recommendedMonthlySavings).toBeLessThanOrEqual(
        summary.averageIncome * 0.15,
      );
    });
  });
});
