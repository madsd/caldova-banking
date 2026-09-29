import type {
  Dashboard,
  FinancialInsight,
  SpendingSummary,
  Transaction,
} from "@/lib/types";

const ESSENTIAL_CATEGORIES = new Set([
  "groceries",
  "health",
  "housing",
  "utilities",
]);

export function buildSavingsProjection(
  dashboard: Dashboard,
  spendingSummary: SpendingSummary,
  monthlySavingAmount: number,
  months: number,
): FinancialInsight {
  requirePositive(monthlySavingAmount, "Monthly saving amount");
  requireIntegerRange(months, 1, 24, "Projection months");
  const savingsBalance = dashboard.accounts
    .filter((account) => account.type === "savings" && account.currency === "UAH")
    .reduce((total, account) => total + account.balance, 0);
  const safeMonthly = spendingSummary.recommendedMonthlySavings;
  const boundedMonthly = Math.min(monthlySavingAmount, safeMonthly);
  const projectedSavings = roundMoney(savingsBalance + boundedMonthly * months);
  const requestedIsAbovePattern = monthlySavingAmount > safeMonthly;

  return {
    kind: "savings_projection",
    title: "Savings projection",
    summary: requestedIsAbovePattern
      ? `Your requested ${formatMoney(monthlySavingAmount)} per month is above the history-based safe amount, so the comparison uses ${formatMoney(boundedMonthly)}.`
      : `Keeping this pattern for ${months} months would add ${formatMoney(boundedMonthly * months)} to savings without assuming investment returns.`,
    metrics: [
      { label: "Savings today", value: formatMoney(savingsBalance) },
      { label: "Monthly plan", value: formatMoney(boundedMonthly) },
      { label: `After ${months} months`, value: formatMoney(projectedSavings) },
    ],
    evidence: [
      {
        title: "Current savings",
        detail: `${formatMoney(savingsBalance)} across visible UAH savings accounts.`,
        source: "Account balances",
      },
      {
        title: "Six-month capacity",
        detail: `${formatMoney(spendingSummary.averageIncome)} average income and ${formatMoney(spendingSummary.averageSpending)} average external spending.`,
        source: "Completed-month transaction history",
      },
    ],
    assumptions: [
      "Income and spending continue near their six-month averages.",
      "No interest, inflation, or market return is assumed.",
      "Transfers to savings do not change total net worth.",
    ],
    methodology:
      "Adds the lower of the requested monthly amount and the deterministic safe-savings recommendation to the current savings balance.",
  };
}

export function buildGoalPlan(
  dashboard: Dashboard,
  spendingSummary: SpendingSummary,
  targetAmount: number,
  months: number,
  goalName: string,
): FinancialInsight {
  requirePositive(targetAmount, "Goal amount");
  requireIntegerRange(months, 1, 60, "Goal months");
  const currentSavings = dashboard.accounts
    .filter((account) => account.type === "savings" && account.currency === "UAH")
    .reduce((total, account) => total + account.balance, 0);
  const gap = Math.max(0, targetAmount - currentSavings);
  const requiredMonthly = roundMoney(gap / months);
  const safeMonthly = spendingSummary.recommendedMonthlySavings;
  const feasible = requiredMonthly <= safeMonthly;
  const safeMonths =
    gap === 0 || safeMonthly === 0 ? 0 : Math.ceil(gap / safeMonthly);

  return {
    kind: "goal_plan",
    title: `${goalName} plan`,
    summary:
      gap === 0
        ? "The visible savings balance already covers this goal."
        : feasible
          ? `${formatMoney(requiredMonthly)} per month reaches the goal within ${months} months and stays inside the history-based safe amount.`
          : `${formatMoney(requiredMonthly)} per month is above the history-based safe amount. At ${formatMoney(safeMonthly)}, the goal takes about ${safeMonths} months.`,
    metrics: [
      { label: "Goal", value: formatMoney(targetAmount) },
      { label: "Saved now", value: formatMoney(currentSavings) },
      { label: "Needed monthly", value: formatMoney(requiredMonthly) },
    ],
    evidence: [
      {
        title: "Goal input",
        detail: `${goalName}: ${formatMoney(targetAmount)} in ${months} months.`,
        source: "Customer request",
      },
      {
        title: "Safe monthly amount",
        detail: `${formatMoney(safeMonthly)} from six completed months.`,
        source: "Transaction analysis",
      },
    ],
    assumptions: [
      "The target and deadline are customer-provided.",
      "Existing savings remain available for this goal.",
      "No interest or investment return is assumed.",
    ],
    methodology:
      "Subtracts visible savings from the target, divides the remaining gap by the requested months, and compares it with the bounded safe-savings amount.",
  };
}

export function buildCashScenarioComparison(
  dashboard: Dashboard,
  spendingSummary: SpendingSummary,
  goalName: string,
  targetAmount: number,
  months: number,
  protectedReserve: number,
): FinancialInsight {
  requirePositive(targetAmount, "Target amount");
  requireIntegerRange(months, 1, 60, "Target months");
  if (!Number.isFinite(protectedReserve) || protectedReserve < 0) {
    throw new Error("Protected reserve cannot be negative.");
  }

  const currentSavings = roundMoney(
    dashboard.accounts
      .filter((account) => account.type === "savings" && account.currency === "UAH")
      .reduce((total, account) => total + account.balance, 0),
  );
  const requiredSavingsBalance = roundMoney(targetAmount + protectedReserve);
  const gap = Math.max(0, roundMoney(requiredSavingsBalance - currentSavings));
  const deadlineMonthly = roundMoney(gap / months);
  const historyMonthly = spendingSummary.recommendedMonthlySavings;
  const historyMonths =
    gap === 0 ? 0 : historyMonthly > 0 ? Math.ceil(gap / historyMonthly) : null;
  const deadlineFitsHistory = deadlineMonthly <= historyMonthly;

  return {
    kind: "scenario_comparison",
    title: `${goalName} options`,
    summary:
      gap === 0
        ? `Visible savings already cover the ${formatMoney(targetAmount)} target while preserving ${formatMoney(protectedReserve)}.`
        : deadlineFitsHistory
          ? `${formatMoney(deadlineMonthly)} per month reaches the target in ${months} months while preserving the stated reserve and staying within observed capacity.`
          : `The requested deadline needs ${formatMoney(deadlineMonthly)} per month, above the observed ${formatMoney(historyMonthly)} capacity. The history-based pace takes about ${historyMonths ?? "an unavailable number of"} months.`,
    metrics: [
      { label: "Customer target", value: formatMoney(targetAmount) },
      { label: "Protected reserve", value: formatMoney(protectedReserve) },
      { label: "Savings today", value: formatMoney(currentSavings) },
      { label: "Gap to fund", value: formatMoney(gap) },
    ],
    scenarios: [
      {
        id: "requested-deadline",
        label: "Requested deadline",
        monthlyAmount: deadlineMonthly,
        durationMonths: months,
        outcome: `${formatMoney(deadlineMonthly)} monthly for ${months} months.`,
        tradeoff: deadlineFitsHistory
          ? "Fits the observed safe-savings capacity."
          : `Requires ${formatMoney(deadlineMonthly - historyMonthly)} more per month than the observed safe-savings capacity.`,
      },
      {
        id: "observed-capacity",
        label: "History-based pace",
        monthlyAmount: historyMonthly,
        durationMonths: historyMonths,
        outcome:
          historyMonths === null
            ? "No positive monthly capacity is visible in the completed-month history."
            : `${formatMoney(historyMonthly)} monthly for about ${historyMonths} months.`,
        tradeoff:
          "Uses the disclosed safe-savings capacity and may move the target date.",
      },
    ],
    evidence: [
      {
        title: "Customer decision constraints",
        detail: `${goalName}: ${formatMoney(targetAmount)} in ${months} months while preserving ${formatMoney(protectedReserve)}.`,
        source: "Customer request",
      },
      {
        title: "Visible savings",
        detail: `${formatMoney(currentSavings)} in UAH savings accounts.`,
        source: "Account balances",
      },
      {
        title: "Observed monthly capacity",
        detail: `${formatMoney(historyMonthly)} from ${spendingSummary.periodMonths} completed months.`,
        source: "Transaction analysis",
      },
    ],
    assumptions: [
      "Target, deadline, and protected reserve are customer-provided.",
      "No interest, inflation, investment return, or unobserved income is assumed.",
      "The comparison does not move money or activate automation.",
    ],
    methodology:
      "Adds the explicit target to the protected reserve, subtracts visible UAH savings, then compares the requested deadline with the deterministic history-based safe-savings capacity.",
  };
}

export function buildMoneyRadar(
  dashboard: Dashboard,
  spendingSummary: SpendingSummary,
): FinancialInsight {
  const completed = spendingSummary.monthly;
  const latest = completed.at(-1);
  const previous = completed.slice(0, -1);
  const previousAverage =
    previous.reduce((sum, month) => sum + month.spending, 0) /
    Math.max(previous.length, 1);
  const change = latest ? roundMoney(latest.spending - previousAverage) : 0;
  const recurring = findRecurringTransactions(dashboard.transactions);
  const nextObligations = roundMoney(
    recurring
      .filter((item) => item.category !== "Subscriptions")
      .reduce((sum, item) => sum + item.latestAmount, 0),
  );
  const afterObligations = roundMoney(
    dashboard.account.balance - nextObligations,
  );

  return {
    kind: "money_radar",
    title: "Your spending last month",
    summary:
      change > 0
        ? `You spent ${formatMoney(change)} more than your average over the previous five months.`
        : `You spent ${formatMoney(Math.abs(change))} less than your average over the previous five months.`,
    metrics: [
      {
        label: "Spent last month",
        value: formatMoney(latest?.spending ?? 0),
      },
      { label: "Recurring next", value: formatMoney(nextObligations) },
      { label: "After obligations", value: formatMoney(afterObligations) },
    ],
    evidence: [
      {
        title: "Completed-month comparison",
        detail: `Latest ${formatMoney(latest?.spending ?? 0)} versus prior average ${formatMoney(previousAverage)}.`,
        source: "Six-month transaction history",
      },
      {
        title: "Repeated obligations",
        detail: recurring.length
          ? recurring
              .slice(0, 4)
              .map((item) => `${item.merchant} ${formatMoney(item.latestAmount)}`)
              .join(", ")
          : "No merchant repeated in at least three completed months.",
        source: "Recurring transaction pattern",
      },
    ],
    assumptions: [
      "Repeated merchants are used as the next-cycle estimate.",
      "No unobserved bills or income are invented.",
    ],
    methodology:
      "Compares the latest completed month with the preceding completed months and subtracts repeated non-subscription obligations from the current primary balance.",
    priority: afterObligations < 10000 ? "now" : "soon",
  };
}

export function buildScamGuardian(
  dashboard: Dashboard,
  query: string,
): FinancialInsight {
  const transaction = findTransaction(dashboard.transactions, query);
  if (!transaction) {
    throw new Error("No matching transaction was found in the visible history.");
  }
  const merchantOccurrences = dashboard.transactions.filter(
    (item) => normalizeMerchant(item.merchant) === normalizeMerchant(transaction.merchant),
  ).length;
  const hour = new Date(transaction.bookedAt).getUTCHours();
  const signals = [
    /card-not-present|online|merchant of record/i.test(
      `${transaction.category} ${transaction.note}`,
    )
      ? "The transaction is marked as online or card-not-present."
      : null,
    hour >= 23 || hour <= 4
      ? `It was booked at ${String(hour).padStart(2, "0")}:00 UTC, outside typical daytime hours.`
      : null,
    merchantOccurrences === 1
      ? "This merchant appears only once in the visible history."
      : null,
  ].filter((signal): signal is string => Boolean(signal));

  return {
    kind: "scam_guardian",
    title: `Scam Guardian: ${transaction.merchant}`,
    summary:
      signals.length >= 2
        ? "Review is recommended because multiple observable signals are present. This is not a fraud verdict."
        : "The visible record has limited warning signals, but only the customer can confirm whether the payment is recognized.",
    metrics: [
      { label: "Amount", value: formatMoney(transaction.amount) },
      { label: "Observable signals", value: String(signals.length) },
      { label: "History occurrences", value: String(merchantOccurrences) },
    ],
    evidence: [
      {
        title: "Transaction record",
        detail: `${transaction.merchant}, ${formatMoney(transaction.amount)}, ${transaction.bookedAt.slice(0, 16).replace("T", " ")} UTC.`,
        source: transaction.id,
      },
      ...signals.map((detail, index) => ({
        title: `Signal ${index + 1}`,
        detail,
        source: "Deterministic transaction rule",
      })),
    ],
    assumptions: [
      "Device, location, and merchant-network data are not available in this demo.",
      "Signals prompt review; they do not prove fraud.",
    ],
    methodology:
      "Checks only visible transaction properties: channel wording, booking time, and merchant recurrence.",
    priority: signals.length >= 2 ? "now" : "explore",
  };
}

export function buildLifeEventPlan(
  dashboard: Dashboard,
  spendingSummary: SpendingSummary,
  eventName: string,
  targetAmount: number,
  months: number,
): FinancialInsight {
  const goal = buildGoalPlan(
    dashboard,
    spendingSummary,
    targetAmount,
    months,
    eventName,
  );
  return {
    ...goal,
    kind: "life_event",
    title: `${eventName} readiness plan`,
    assumptions: [
      ...goal.assumptions,
      "The plan covers the stated cash target only; event-specific costs must be added by the customer.",
    ],
    methodology: `${goal.methodology} The result remains a reversible plan until the customer chooses an automation.`,
  };
}

export function buildSubscriptionReview(
  dashboard: Dashboard,
): FinancialInsight {
  const recurring = findRecurringTransactions(dashboard.transactions).filter(
    (item) => item.category === "Subscriptions",
  );
  const monthlyTotal = roundMoney(
    recurring.reduce((sum, item) => sum + item.latestAmount, 0),
  );
  const changed = recurring.filter(
    (item) => Math.abs(item.latestAmount - item.previousAverage) >= 1,
  );

  return {
    kind: "subscription_optimizer",
    title: "Your recurring subscriptions",
    summary: recurring.length
      ? `${recurring.length} subscription${recurring.length === 1 ? "" : "s"} spotted in your payments.${changed.length ? ` ${changed.length} changed price.` : ""}`
      : "No subscriptions repeated across three or more months.",
    metrics: [
      { label: "Monthly total", value: formatMoney(monthlyTotal) },
      { label: "Repeated services", value: String(recurring.length) },
      { label: "Changed price", value: String(changed.length) },
    ],
    evidence: recurring.map((item) => ({
      title: item.merchant,
      detail: `${formatMoney(item.latestAmount)} latest; ${formatMoney(item.previousAverage)} earlier-month average; ${item.occurrences} visible payments.`,
      source: "Transaction history",
    })),
    assumptions: [
      "A subscription must repeat in at least three distinct months.",
      "Merchant-name normalization merges only punctuation and letter case.",
      "Cancellation remains with the merchant; no service is stopped automatically.",
    ],
    methodology:
      "Groups subscription-category debits by normalized merchant, then compares the latest amount with the average of earlier visible months.",
    priority: changed.length ? "soon" : "explore",
  };
}

export function buildResiliencePlan(
  dashboard: Dashboard,
  spendingSummary: SpendingSummary,
): FinancialInsight {
  const essentialMonthly = roundMoney(
    sumCategories(
      dashboard.transactions,
      ESSENTIAL_CATEGORIES,
      new Set(spendingSummary.monthly.map((month) => month.month)),
    ) / spendingSummary.periodMonths,
  );
  const liquidReserve = roundMoney(
    dashboard.accounts
      .filter((account) => account.currency === "UAH")
      .reduce((sum, account) => sum + account.balance, 0),
  );
  const runwayMonths =
    essentialMonthly === 0 ? 0 : roundMoney(liquidReserve / essentialMonthly);
  const targetReserve = roundMoney(essentialMonthly * 3);
  const gap = Math.max(0, roundMoney(targetReserve - liquidReserve));

  return {
    kind: "resilience_plan",
    title: "Your cash cushion",
    summary:
      gap === 0
        ? `Your balances could cover about ${runwayMonths} months of essential spending, based on recent payments.`
        : `Your balances could cover about ${runwayMonths} months of essential spending. Another ${formatMoney(gap)} would cover three months.`,
    metrics: [
      { label: "Coverage", value: `${runwayMonths} months` },
      { label: "Essential month", value: formatMoney(essentialMonthly) },
      { label: "Liquid UAH", value: formatMoney(liquidReserve) },
    ],
    evidence: [
      {
        title: "Essential categories",
        detail: "Housing, utilities, groceries, and health debits across six completed months.",
        source: "Transaction categories",
      },
      {
        title: "Visible liquidity",
        detail: `${formatMoney(liquidReserve)} across current, digital, and savings UAH accounts.`,
        source: "Account balances",
      },
    ],
    assumptions: [
      "The three-month reserve is a planning reference, not financial advice.",
      "Only visible UAH balances and observed essential categories are included.",
    ],
    methodology:
      "Divides visible UAH liquidity by average monthly essential spending and compares the result with a transparent three-month reference.",
    priority: runwayMonths < 3 ? "now" : "explore",
  };
}

export function buildAdaptiveInsights(
  dashboard: Dashboard,
  spendingSummary: SpendingSummary,
): FinancialInsight[] {
  const candidates: FinancialInsight[] = [
    buildMoneyRadar(dashboard, spendingSummary),
    buildSubscriptionReview(dashboard),
    buildResiliencePlan(dashboard, spendingSummary),
  ];
  const suspicious = dashboard.transactions.find((transaction) =>
    /card-not-present|merchant of record/i.test(transaction.note),
  );
  if (suspicious) {
    candidates.push(buildScamGuardian(dashboard, suspicious.merchant));
  }
  const priorityOrder = { now: 0, soon: 1, explore: 2 };
  return candidates
    .sort(
      (left, right) =>
        priorityOrder[left.priority ?? "explore"] -
        priorityOrder[right.priority ?? "explore"],
    )
    .slice(0, 3)
    .map((insight) => ({
      ...insight,
      kind: "adaptive_banking",
      suggestedPrompt: promptForInsight(insight),
    }));
}

function promptForInsight(insight: FinancialInsight) {
  if (insight.kind === "scam_guardian") {
    return `Investigate ${insight.title.replace("Scam Guardian: ", "")} as a suspicious payment.`;
  }
  if (insight.kind === "subscription_optimizer") {
    return "Review my subscriptions and show any price changes.";
  }
  if (insight.kind === "resilience_plan") {
    return "Show my financial resilience plan.";
  }
  return "Show my Money Radar forecast.";
}

function findRecurringTransactions(transactions: Transaction[]) {
  const groups = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    if (transaction.direction !== "debit" || transaction.currency !== "UAH") continue;
    const key = normalizeMerchant(transaction.merchant);
    groups.set(key, [...(groups.get(key) ?? []), transaction]);
  }

  return [...groups.values()]
    .map((items) => {
      const byMonth = new Map<string, Transaction>();
      for (const item of items) {
        const month = item.bookedAt.slice(0, 7);
        const current = byMonth.get(month);
        if (!current || item.bookedAt > current.bookedAt) byMonth.set(month, item);
      }
      const ordered = [...byMonth.values()].sort((a, b) =>
        a.bookedAt.localeCompare(b.bookedAt),
      );
      const latest = ordered.at(-1)!;
      const previous = ordered.slice(0, -1);
      return {
        merchant: latest.merchant,
        category: latest.category,
        latestAmount: latest.amount,
        previousAverage: previous.length
          ? roundMoney(
              previous.reduce((sum, item) => sum + item.amount, 0) /
                previous.length,
            )
          : latest.amount,
        occurrences: ordered.length,
      };
    })
    .filter((item) => item.occurrences >= 3)
    .sort((left, right) => right.latestAmount - left.latestAmount);
}

function findTransaction(transactions: Transaction[], query: string) {
  const normalized = query.toLocaleLowerCase().trim();
  return transactions.find((transaction) =>
    `${transaction.merchant} ${transaction.category} ${transaction.note}`
      .toLocaleLowerCase()
      .includes(normalized),
  );
}

function sumCategories(
  transactions: Transaction[],
  categories: Set<string>,
  months: Set<string>,
) {
  return transactions
    .filter(
      (transaction) =>
        transaction.direction === "debit" &&
        transaction.currency === "UAH" &&
        months.has(transaction.bookedAt.slice(0, 7)) &&
        categories.has(transaction.category.toLocaleLowerCase()),
    )
    .reduce((sum, transaction) => sum + transaction.amount, 0);
}

function normalizeMerchant(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function requirePositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
}

function requireIntegerRange(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency: "UAH",
    minimumFractionDigits: 2,
  })
    .format(amount)
    .replace("грн", "₴")
    .trim();
}
