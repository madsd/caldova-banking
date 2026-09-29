type RuleField = {
  label: string;
  value: string;
};

export type SalaryAllocation = {
  fields: RuleField[];
  evidence: Array<{ title: string; detail: string }>;
  movementAmount: number;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function formatUah(value: number) {
  return `₴${value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function parseMoney(value: string) {
  let normalized = value.replace(/[^\d,.-]/g, "");
  if (normalized.includes(",") && normalized.includes(".")) {
    const decimalSeparator =
      normalized.lastIndexOf(",") > normalized.lastIndexOf(".") ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = normalized.replaceAll(thousandsSeparator, "");
    if (decimalSeparator === ",") normalized = normalized.replace(",", ".");
  } else if (normalized.includes(",")) {
    normalized = /,\d{2}$/.test(normalized)
      ? normalized.replace(",", ".")
      : normalized.replaceAll(",", "");
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid allocation amount: ${value}`);
  }
  return parsed;
}

function resolveInstruction(value: string, salary: number) {
  const percentMatch = value.match(/^([\d.]+)% of salary$/i);
  if (!percentMatch) return roundMoney(parseMoney(value));

  const percent = Number(percentMatch[1]);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error(`Invalid allocation percentage: ${value}`);
  }
  return roundMoney((salary * percent) / 100);
}

function findValue(fields: RuleField[], ...labels: string[]) {
  for (const label of labels) {
    const value = fields.find((field) => field.label === label)?.value;
    if (value !== undefined) return value;
  }
  return undefined;
}

export function parseApprovedRule(ruleJson: string) {
  const value: unknown = JSON.parse(ruleJson);
  if (
    !Array.isArray(value) ||
    value.some(
      (field) =>
        typeof field !== "object" ||
        field === null ||
        typeof field.label !== "string" ||
        typeof field.value !== "string",
    )
  ) {
    throw new Error("Approved salary rule has an invalid field structure.");
  }
  return value as RuleField[];
}

export function buildSalaryAllocation(
  salary: number,
  approvedRule?: RuleField[],
): SalaryAllocation {
  if (!Number.isFinite(salary) || salary <= 0) {
    throw new Error("Salary must be a positive amount.");
  }

  if (!approvedRule) {
    const reserve = roundMoney(salary * 0.3);
    const bills = roundMoney(salary * 0.45);
    const savings = roundMoney(salary * 0.15);
    const flexible = roundMoney(salary - reserve - bills - savings);
    return {
      movementAmount: roundMoney(bills + savings),
      fields: [
        { label: "Salary detected", value: formatUah(salary) },
        { label: "Keep as reserve", value: formatUah(reserve) },
        { label: "Bills envelope", value: formatUah(bills) },
        { label: "Move to savings", value: formatUah(savings) },
        { label: "Flexible spending", value: formatUah(flexible) },
      ],
      evidence: [
        {
          title: "Default demo rule",
          detail:
            "No approved customer rule was available, so the disclosed 30/45/15/10 demo split was used.",
        },
      ],
    };
  }

  const savingsInstruction = findValue(
    approvedRule,
    "Savings instruction",
    "Safety reserve",
  );
  const billsInstruction = findValue(
    approvedRule,
    "Bills instruction",
    "Bills pocket",
  );
  const availableInstruction = findValue(
    approvedRule,
    "Minimum left available",
    "Available after plan",
  );
  if (!savingsInstruction || !billsInstruction || !availableInstruction) {
    throw new Error("Approved salary rule is missing allocation instructions.");
  }

  const requestedSavings = resolveInstruction(savingsInstruction, salary);
  const bills = resolveInstruction(billsInstruction, salary);
  const minimumAvailable = parseMoney(availableInstruction);
  const allocatable = roundMoney(salary - minimumAvailable);
  if (allocatable < 0 || bills > allocatable) {
    throw new Error(
      "Approved bills allocation cannot preserve the minimum available reserve.",
    );
  }
  const savings = Math.min(requestedSavings, roundMoney(allocatable - bills));
  const available = roundMoney(salary - savings - bills);

  return {
    movementAmount: roundMoney(bills + savings),
    fields: [
      { label: "Salary detected", value: formatUah(salary) },
      { label: "Bills pocket", value: formatUah(bills) },
      { label: "Move to savings", value: formatUah(savings) },
      { label: "Kept available", value: formatUah(available) },
    ],
    evidence: [
      {
        title: "Approved rule applied",
        detail: `Savings: ${savingsInstruction}. Bills: ${billsInstruction}. Minimum available: ${formatUah(minimumAvailable)}.`,
      },
      ...(savings < requestedSavings
        ? [
            {
              title: "Savings adjusted",
              detail: `Savings was capped at ${formatUah(savings)} to preserve the approved minimum available reserve.`,
            },
          ]
        : []),
    ],
  };
}
