import { randomUUID } from "node:crypto";
import type { AgentPlan, CashScenario, Evidence } from "@/lib/types";

export type AgentPlanUpdate = {
  operation: "create" | "update";
  objective: string;
  status: AgentPlan["status"];
  constraints: string[];
  openQuestions: string[];
  steps: AgentPlan["steps"];
};

const PLAN_STATUSES = new Set<AgentPlan["status"]>([
  "active",
  "needs_input",
  "ready_for_decision",
  "completed",
]);

function normalized(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}₴%]+/gu, " ")
    .trim();
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function applyAgentPlanUpdate(
  current: AgentPlan | null,
  update: AgentPlanUpdate,
  customerMessages: string[],
) {
  const source = normalized(customerMessages.join("\n"));
  const previousConstraints =
    update.operation === "update" && current ? current.constraints : [];
  const newConstraints = update.constraints.filter(
    (constraint) => source.includes(normalized(constraint)),
  );
  const constraints = unique([...previousConstraints, ...newConstraints]);
  const incomingSteps = [
    ...new Map(
      update.steps.map((step) => [
        step.id,
        {
          ...step,
          id: step.id.trim(),
          title: step.title.trim(),
        },
      ]),
    ).values(),
  ];
  const steps =
    update.operation === "update" && current
      ? [
          ...new Map(
            [
              ...current.steps,
              ...incomingSteps.map((step) => {
                const previous = current.steps.find(
                  (candidate) => candidate.id === step.id,
                );
                return previous?.status === "completed" &&
                  (step.status === "pending" || step.status === "running")
                  ? { ...step, status: "completed" as const }
                  : step;
              }),
            ].map((step) => [step.id, step]),
          ).values(),
        ]
      : incomingSteps;
  const previousEvidence =
    update.operation === "update" && current ? current.evidence : [];
  const previousScenarios =
    update.operation === "update" && current ? current.scenarios : [];
  const previousActions =
    update.operation === "update" && current ? current.proposedActions : [];
  const hasDecisionMaterial =
    previousEvidence.length > 0 ||
    previousScenarios.length > 0 ||
    previousActions.length > 0;
  const toolSteps = steps.filter((step) => step.toolName !== null);
  const allToolStepsResolved =
    toolSteps.length > 0 &&
    toolSteps.every(
      (step) => step.status === "completed" || step.status === "skipped",
    );
  const status =
    update.status === "ready_for_decision" &&
    (!hasDecisionMaterial || !allToolStepsResolved)
      ? "active"
      : update.status === "needs_input" && update.openQuestions.length === 0
        ? "active"
        : update.status;

  return {
    id:
      update.operation === "update" && current ? current.id : randomUUID(),
    objective: update.objective.trim(),
    status,
    constraints,
    openQuestions: unique(update.openQuestions),
    steps,
    evidence: previousEvidence,
    scenarios: previousScenarios,
    proposedActions: previousActions,
    updatedAt: new Date().toISOString(),
  } satisfies AgentPlan;
}

export function normalizeAgentPlan(value: unknown): AgentPlan | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.objective !== "string" ||
    !PLAN_STATUSES.has(candidate.status as AgentPlan["status"]) ||
    !Array.isArray(candidate.steps)
  ) {
    return null;
  }

  const steps = candidate.steps.flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const step = value as Record<string, unknown>;
    const status = [
      "pending",
      "running",
      "completed",
      "blocked",
      "skipped",
    ].includes(String(step.status))
      ? (step.status as AgentPlan["steps"][number]["status"])
      : "pending";
    const id =
      typeof step.id === "string"
        ? step.id
        : typeof step.kind === "string"
          ? step.kind.replaceAll("_", "-")
          : `step-${index + 1}`;
    const title =
      typeof step.title === "string"
        ? step.title
        : typeof step.label === "string"
          ? step.label
          : `Plan step ${index + 1}`;
    return [
      {
        id,
        title,
        toolName: typeof step.toolName === "string" ? step.toolName : null,
        status,
      },
    ];
  });

  return {
    id: candidate.id,
    objective: candidate.objective,
    status: candidate.status as AgentPlan["status"],
    constraints: Array.isArray(candidate.constraints)
      ? candidate.constraints.filter(
          (constraint): constraint is string => typeof constraint === "string",
        )
      : [],
    openQuestions: Array.isArray(candidate.openQuestions)
      ? candidate.openQuestions.filter(
          (question): question is string => typeof question === "string",
        )
      : [],
    steps,
    evidence: Array.isArray(candidate.evidence)
      ? (candidate.evidence as Evidence[])
      : [],
    scenarios: Array.isArray(candidate.scenarios)
      ? (candidate.scenarios as CashScenario[])
      : [],
    proposedActions: Array.isArray(candidate.proposedActions)
      ? (candidate.proposedActions as AgentPlan["proposedActions"])
      : [],
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : new Date().toISOString(),
  };
}

export function updatePlanStep(
  plan: AgentPlan,
  stepId: string | undefined,
  status: AgentPlan["steps"][number]["status"],
) {
  if (!stepId) return plan;
  return {
    ...plan,
    steps: plan.steps.map((step) =>
      step.id === stepId ? { ...step, status } : step,
    ),
    updatedAt: new Date().toISOString(),
  } satisfies AgentPlan;
}

export function reconcileAgentPlan(plan: AgentPlan) {
  if (
    plan.status === "completed" ||
    plan.status === "ready_for_decision"
  ) {
    return plan;
  }
  if (
    plan.openQuestions.length > 0 ||
    plan.steps.some((step) => step.status === "blocked")
  ) {
    return {
      ...plan,
      status: "needs_input",
      updatedAt: new Date().toISOString(),
    } satisfies AgentPlan;
  }

  const toolSteps = plan.steps.filter((step) => step.toolName !== null);
  const hasGroundedResult =
    plan.evidence.length > 0 ||
    plan.scenarios.length > 0 ||
    plan.proposedActions.length > 0;
  if (
    toolSteps.length > 0 &&
    toolSteps.every(
      (step) => step.status === "completed" || step.status === "skipped",
    ) &&
    hasGroundedResult
  ) {
    return {
      ...plan,
      status: "ready_for_decision",
      updatedAt: new Date().toISOString(),
    } satisfies AgentPlan;
  }
  return plan;
}

export function addPlanEvidence(plan: AgentPlan, evidence: Evidence[]) {
  const keyed = new Map(
    [...plan.evidence, ...evidence].map((item) => [
      `${item.title}|${item.detail}|${item.source ?? ""}`,
      item,
    ]),
  );
  return {
    ...plan,
    evidence: [...keyed.values()].slice(-12),
    updatedAt: new Date().toISOString(),
  } satisfies AgentPlan;
}

export function addPlanScenarios(
  plan: AgentPlan,
  scenarios: CashScenario[],
) {
  return {
    ...plan,
    scenarios,
    updatedAt: new Date().toISOString(),
  } satisfies AgentPlan;
}
