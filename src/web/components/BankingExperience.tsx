"use client";

import {
  ChangeEvent,
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  findGuidedTour,
  guidedTours,
  type TourAction,
} from "@/lib/guided-tours";
import { advisorTopics } from "@/lib/types";
import type {
  ActionIntent,
  AdvisorMessage,
  AdvisorTopic,
  AgentEvent,
  AgentPlan,
  ChatTurn,
  Dashboard,
  Evidence,
  FinancialInsight,
  PersonaSummary,
  Transaction,
} from "@/lib/types";

type TraceItem = {
  id: string;
  name: string;
  detail: string;
  state: "running" | "complete";
};

type DragState = {
  pointerId: number;
  startY: number;
  scrollTop: number;
  moved: boolean;
};

type CarouselDragState = {
  pointerId: number;
  startX: number;
  scrollLeft: number;
  moved: boolean;
};

const prompts = [
  {
    label: "Move money between accounts",
    prompt:
      "Move 100 UAH from my primary account to a savings account. Prepare it for my approval.",
  },
  {
    label: "Repeat my last top-up",
    prompt: "Top up my phone with the same amount as last time.",
  },
  {
    label: "Explain my latest charge",
    prompt: "Explain my latest card charge and any fee related to it.",
  },
  {
    label: "Plan my next salary",
    prompt:
      "When my next salary arrives, protect my reserve and prepare a savings plan.",
  },
  {
    label: "Show my recent spending",
    prompt: "Show my recent spending and highlight anything unusual.",
  },
  {
    label: "Compare savings options",
    prompt: "Compare Caldova Bank savings options and explain which could fit me.",
  },
  {
    label: "What can I safely save?",
    prompt:
      "Based on my balance and recent activity, how much could I safely move to savings?",
  },
];

export function BankingExperience() {
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [personaId, setPersonaId] = useState("andrii");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [input, setInput] = useState("");
  const [userMessage, setUserMessage] = useState("");
  const [assistantMessage, setAssistantMessage] = useState("");
  const [conversationHistory, setConversationHistory] = useState<ChatTurn[]>([]);
  const [sources, setSources] = useState<Evidence[]>([]);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const evidenceTriggerRef = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<{
    title: string;
    detail: string;
  } | null>(null);
  const [traces, setTraces] = useState<TraceItem[]>([]);
  const [intent, setIntent] = useState<ActionIntent | null>(null);
  const [advisorMessages, setAdvisorMessages] = useState<AdvisorMessage[]>([]);
  const [advisorDraft, setAdvisorDraft] = useState<AdvisorMessage | null>(null);
  const [advisorTopic, setAdvisorTopic] =
    useState<AdvisorTopic>("Payments and transfers");
  const [advisorText, setAdvisorText] = useState("");
  const [advisorBusy, setAdvisorBusy] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const advisorName = dashboard?.persona.advisorName ?? "your advisor";
  const advisorFirstName = dashboard?.persona.advisorName?.split(" ")[0];
  const [agentPlan, setAgentPlan] = useState<AgentPlan | null>(null);
  const [showProcessDetails, setShowProcessDetails] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<ActionIntent | null>(null);
  const [eventPending, setEventPending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [activeAccountIndex, setActiveAccountIndex] = useState(0);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [adaptiveInsights, setAdaptiveInsights] = useState<FinancialInsight[]>([]);
  const [activeTourId, setActiveTourId] = useState(guidedTours[0].id);
  const [tourStepIndex, setTourStepIndex] = useState(0);
  const [tourRunning, setTourRunning] = useState(false);
  const [tourPaused, setTourPaused] = useState(false);
  const [tourTargetFound, setTourTargetFound] = useState(true);
  const [tourPromptStaged, setTourPromptStaged] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const carouselDragStateRef = useRef<CarouselDragState | null>(null);
  const suppressCarouselClickRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const autoScrollFrameRef = useRef<number | null>(null);
  const latestAnswerRef = useRef<HTMLDivElement>(null);
  const wasLoadingRef = useRef(false);
  const tourTargetRef = useRef<HTMLElement | null>(null);
  const stagedTourPromptRef = useRef<{
    tourId: string;
    stepIndex: number;
  } | null>(null);
  const tourStateRef = useRef({
    tourId: activeTourId,
    stepIndex: tourStepIndex,
    running: tourRunning,
  });

  function handleScreenPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      scrollTop: event.currentTarget.scrollTop,
      moved: false,
    };
  }

  function handleScreenPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(distance) < 5) return;
    drag.moved = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("is-dragging");
    event.currentTarget.scrollTop = drag.scrollTop - distance;
    event.preventDefault();
  }

  function endScreenDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
    dragStateRef.current = null;
    event.currentTarget.classList.remove("is-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (suppressClickRef.current) {
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  }

  function handleScreenClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  }

  function handleCarouselPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    event.stopPropagation();
    carouselDragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    };
  }

  function handleCarouselPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = carouselDragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const distance = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(distance) < 5) return;
    drag.moved = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("is-dragging");
    event.currentTarget.scrollLeft = drag.scrollLeft - distance;
    event.preventDefault();
  }

  function endCarouselDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = carouselDragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    suppressCarouselClickRef.current = drag.moved;
    carouselDragStateRef.current = null;
    event.currentTarget.classList.remove("is-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (suppressCarouselClickRef.current) {
      window.setTimeout(() => {
        suppressCarouselClickRef.current = false;
      }, 0);
    }
  }

  function handleCarouselClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    if (!suppressCarouselClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressCarouselClickRef.current = false;
  }

  function handleAccountScroll(event: React.UIEvent<HTMLDivElement>) {
    const firstCard = event.currentTarget.firstElementChild as HTMLElement | null;
    if (!firstCard) return;
    const step = firstCard.offsetWidth + 12;
    setActiveAccountIndex(Math.round(event.currentTarget.scrollLeft / step));
  }

  const loadDashboard = useCallback(async (selectedPersona: string) => {
    const [dashboardResponse, insightResponse] = await Promise.all([
      fetch(`/api/dashboard?personaId=${encodeURIComponent(selectedPersona)}`, {
        cache: "no-store",
      }),
      fetch(`/api/insights?personaId=${encodeURIComponent(selectedPersona)}`, {
        cache: "no-store",
      }),
    ]);
    if (!dashboardResponse.ok) {
      throw new Error("Could not load the selected customer.");
    }
    return {
      dashboard: (await dashboardResponse.json()) as Dashboard,
      insights: insightResponse.ok
        ? (((await insightResponse.json()) as { insights: FinancialInsight[] })
            .insights ?? [])
        : [],
    };
  }, []);

  const loadAdvisorMessages = useCallback(async (selectedPersona: string) => {
    const response = await fetch(
      `/api/advisor/messages?personaId=${encodeURIComponent(selectedPersona)}`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error("Could not load advisor messages.");
    }
    return ((await response.json()) as { messages: AdvisorMessage[] }).messages;
  }, []);

  const scrollAssistantToLatest = useCallback(() => {
    if (autoScrollFrameRef.current !== null) {
      cancelAnimationFrame(autoScrollFrameRef.current);
    }
    autoScrollFrameRef.current = requestAnimationFrame(() => {
      autoScrollFrameRef.current = null;
      screenRef.current?.scrollTo({
        top: screenRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }, []);

  const scrollAssistantToAnswer = useCallback(() => {
    if (autoScrollFrameRef.current !== null) {
      cancelAnimationFrame(autoScrollFrameRef.current);
    }
    autoScrollFrameRef.current = requestAnimationFrame(() => {
      autoScrollFrameRef.current = null;
      const screen = screenRef.current;
      const answer = latestAnswerRef.current;
      if (!screen || !answer) return;
      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      screen.scrollTo({
        top:
          screen.scrollTop +
          answer.getBoundingClientRect().top -
          screen.getBoundingClientRect().top -
          82,
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
    });
  }, []);

  useEffect(() => {
    tourStateRef.current = {
      tourId: activeTourId,
      stepIndex: tourStepIndex,
      running: tourRunning,
    };
  }, [activeTourId, tourRunning, tourStepIndex]);

  useEffect(() => {
    Promise.all([
      fetch("/api/personas", { cache: "no-store" }).then((response) =>
        response.json(),
      ),
      loadDashboard(personaId),
    ])
      .then(([personaResponse, loaded]) => {
        setPersonas(personaResponse.personas as PersonaSummary[]);
        setDashboard(loaded.dashboard);
        setAdaptiveInsights(loaded.insights);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Loading failed.");
      });
  }, [loadDashboard, personaId]);

  useEffect(() => {
    if (!assistantOpen) return;
    if (loading) {
      wasLoadingRef.current = true;
      scrollAssistantToLatest();
    } else if (wasLoadingRef.current) {
      wasLoadingRef.current = false;
      scrollAssistantToAnswer();
    }
  }, [
    assistantMessage,
    assistantOpen,
    conversationHistory,
    error,
    intent,
    agentPlan,
    loading,
    scrollAssistantToAnswer,
    scrollAssistantToLatest,
    sources,
    status,
    success,
    traces,
  ]);

  useEffect(
    () => () => {
      if (autoScrollFrameRef.current !== null) {
        cancelAnimationFrame(autoScrollFrameRef.current);
      }
    },
    [],
  );

  const activeTour = findGuidedTour(activeTourId);
  const activeTourStep = activeTour.steps[tourStepIndex] ?? activeTour.steps[0];
  const activeTourTarget = tourPromptStaged
    ? "command-input"
    : activeTourStep.target;
  const activePlanStep =
    agentPlan?.steps.find((step) => step.status === "running") ??
    agentPlan?.steps.find((step) => step.status === "blocked") ??
    agentPlan?.steps.find((step) => step.status === "pending");
  const completedPlanSteps =
    agentPlan?.steps.filter((step) => step.status === "completed").length ?? 0;
  const tourNeedsProcessDetails =
    tourRunning &&
    ["assistant-evidence", "agent-plan"].includes(
      activeTourTarget,
    );

  useEffect(() => {
    tourTargetRef.current?.classList.remove("tour-focus");
    tourTargetRef.current = null;
    if (!tourRunning || tourPaused) return;

    let frame = 0;
    let attempts = 0;
    const findTarget = () => {
      const target = document.querySelector<HTMLElement>(
        `[data-tour="${activeTourTarget}"]`,
      );
      if (target) {
        target.classList.add("tour-focus");
        tourTargetRef.current = target;
        setTourTargetFound(true);
        target.scrollIntoView({ behavior: "smooth", block: "nearest" });
        return;
      }
      attempts += 1;
      if (attempts < 60) {
        frame = requestAnimationFrame(findTarget);
      } else {
        setTourTargetFound(false);
      }
    };
    frame = requestAnimationFrame(findTarget);

    return () => {
      cancelAnimationFrame(frame);
      tourTargetRef.current?.classList.remove("tour-focus");
      tourTargetRef.current = null;
    };
  }, [
    activeTourTarget,
    assistantOpen,
    intent,
    sources,
    tourPaused,
    tourRunning,
    traces,
  ]);

  function handleAgentEvent(event: AgentEvent) {
    if (event.type === "status") {
      setStatus({ title: event.title, detail: event.detail });
    } else if (event.type === "tool_start") {
      setStatus(null);
      setTraces((current) => [
        ...current,
        {
          id: event.id,
          name: event.name,
          detail: event.detail,
          state: "running",
        },
      ]);
    } else if (event.type === "tool_result") {
      setTraces((current) =>
        current.map((trace) =>
          trace.id === event.id
            ? { ...trace, detail: event.detail, state: "complete" }
            : trace,
        ),
      );
    } else if (event.type === "message") {
      setAssistantMessage(event.text);
      setSources(event.sources ?? []);
    } else if (event.type === "intent") {
      setAdvisorDraft(null);
      setIntent(event.intent);
      setApprovalOpen(true);
    } else if (event.type === "advisor_draft") {
      setIntent(null);
      setAdvisorDraft(event.message);
      setAdvisorMessages((current) => [
        event.message,
        ...current.filter((message) => message.id !== event.message.id),
      ]);
      setApprovalOpen(true);
    } else if (event.type === "plan") {
      setAgentPlan(event.plan);
    } else if (event.type === "error") {
      setError(event.message);
    }
  }

  async function sendMessage(message: string): Promise<boolean> {
    const trimmed = message.trim();
    if (!trimmed || loading) return false;
    stagedTourPromptRef.current = null;
    setTourPromptStaged(false);

    setAssistantOpen(true);
    setAdvisorOpen(false);
    setLoading(true);
    setError("");
    setSuccess(null);
    setIntent(null);
    setAdvisorDraft(null);
    setApprovalOpen(false);
    setShowProcessDetails(true);
    setShowEvidence(false);
    setTraces([]);
    setAgentPlan(null);
    setAssistantMessage("");
    setSources([]);
    setEvidenceOpen(false);
    setStatus({
      title: "Connecting to Caldova",
      detail: "Starting a customer-scoped banking session…",
    });
    setUserMessage(trimmed);
    setInput("");
    const requestHistory = conversationHistory.slice(-12);
    let completedAssistantMessage = "";
    let requestCompleted = false;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personaId,
          message: trimmed,
          history: requestHistory,
        }),
      });
      if (!response.ok || !response.body) {
        throw new Error("The banking assistant could not start.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const data = block
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (data) {
            const agentEvent = JSON.parse(data.slice(6)) as AgentEvent;
            if (agentEvent.type === "message") {
              completedAssistantMessage = agentEvent.text;
            }
            handleAgentEvent(agentEvent);
          }
        }
      }
      requestCompleted = true;
      if (completedAssistantMessage) {
        setConversationHistory([
          ...requestHistory,
          { role: "user", content: trimmed },
          { role: "assistant", content: completedAssistantMessage },
        ]);
        setUserMessage("");
        setAssistantMessage("");
      }
    } catch (cause: unknown) {
      setError(
        cause instanceof Error ? cause.message : "The assistant request failed.",
      );
    } finally {
      setLoading(false);
      setStatus(null);
      if (completedAssistantMessage) {
        setShowProcessDetails(false);
      }
    }
    return requestCompleted;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const stagedPrompt = stagedTourPromptRef.current;
    const completed = await sendMessage(input);
    const currentTour = tourStateRef.current;
    if (
      completed &&
      stagedPrompt &&
      currentTour.running &&
      currentTour.tourId === stagedPrompt.tourId &&
      currentTour.stepIndex === stagedPrompt.stepIndex
    ) {
      moveTour(1);
    }
  }

  async function approveIntentWithConfirmation() {
    if (!intent) return;
    setApproving(true);
    setError("");
    try {
      const response = await fetch(`/api/intents/${intent.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId }),
      });
      const result = (await response.json()) as {
        intent?: ActionIntent;
        dashboard?: Dashboard;
        error?: string;
      };
      if (!response.ok || !result.intent || !result.dashboard) {
        throw new Error(result.error ?? "Approval failed.");
      }
      setIntent(null);
      setAdvisorDraft(null);
      setApprovalOpen(false);
      setApprovalOpen(false);
      setSuccess(result.intent);
      setDashboard(result.dashboard);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Approval failed.");
    } finally {
      setApproving(false);
    }
  }

  async function openAdvisorMessages() {
    closeAssistant();
    setSelectedAccountId(null);
    setAdvisorOpen(true);
    setError("");
    try {
      setAdvisorMessages(await loadAdvisorMessages(personaId));
    } catch (cause: unknown) {
      setError(
        cause instanceof Error ? cause.message : "Advisor messages failed.",
      );
    }
  }

  async function prepareManualAdvisorDraft(event: FormEvent) {
    event.preventDefault();
    const message = advisorText.trim();
    if (!message || advisorBusy) return;
    setAdvisorBusy(true);
    setError("");
    try {
      const response = await fetch("/api/advisor/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personaId,
          topic: advisorTopic,
          message,
        }),
      });
      const result = (await response.json()) as {
        message?: AdvisorMessage;
        error?: string;
      };
      if (!response.ok || !result.message) {
        throw new Error(result.error ?? "Advisor message draft failed.");
      }
      setAdvisorDraft(result.message);
      setAdvisorMessages((current) => [
        result.message!,
        ...current.filter((item) => item.id !== result.message!.id),
      ]);
      setAdvisorText("");
      setApprovalOpen(true);
    } catch (cause: unknown) {
      setError(
        cause instanceof Error ? cause.message : "Advisor message draft failed.",
      );
    } finally {
      setAdvisorBusy(false);
    }
  }

  async function sendAdvisorDraftWithConfirmation() {
    if (!advisorDraft) return;
    setApproving(true);
    setError("");
    try {
      const response = await fetch(
        `/api/advisor/messages/${advisorDraft.id}/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ personaId }),
        },
      );
      const result = (await response.json()) as {
        message?: AdvisorMessage;
        error?: string;
      };
      if (!response.ok || !result.message) {
        throw new Error(result.error ?? "Advisor message could not be sent.");
      }
      setAdvisorMessages((current) =>
        current.map((message) =>
          message.id === result.message!.id ? result.message! : message,
        ),
      );
      setAdvisorDraft(null);
      setApprovalOpen(false);
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Advisor message could not be sent.",
      );
    } finally {
      setApproving(false);
    }
  }

  async function triggerSalaryEvent() {
    setEventPending(true);
    setError("");
    try {
      const response = await fetch("/api/events/salary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId }),
      });
      const result = (await response.json()) as {
        mode?: string;
        eventId?: string;
        intent?: ActionIntent;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Salary event failed.");
      }

      setAssistantOpen(true);
      setUserMessage("A salary event arrived.");
      setAssistantMessage(
        result.mode === "service-bus"
          ? "The salary event is on Service Bus. The event agent is preparing a proposal."
          : "The local event handler prepared a salary allocation proposal.",
      );
      if (result.intent) setIntent(result.intent);
      setTraces([
        {
          id: "salary-event",
          name: "salary_posted",
          detail:
            result.mode === "service-bus"
              ? "Published to Azure Service Bus"
              : "Handled in local preview",
          state: "complete",
        },
      ]);
      if (result.mode === "service-bus") {
        for (let attempt = 0; attempt < 12; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 750));
          const pendingResponse = await fetch(
            `/api/intents?personaId=${encodeURIComponent(personaId)}`,
            { cache: "no-store" },
          );
          if (!pendingResponse.ok) continue;
          const pending = (await pendingResponse.json()) as {
            intents?: ActionIntent[];
          };
          const salaryIntent = pending.intents?.find(
            (item) =>
              item.type === "salary_allocation" &&
              item.sourceEventId === result.eventId,
          );
          if (salaryIntent) {
            setIntent(salaryIntent);
            setAssistantMessage(
              "The event agent prepared a salary allocation proposal. Review the evidence and approve it only if it looks right.",
            );
            setTraces((current) => [
              ...current,
              {
                id: "salary-proposal",
                name: "prepare_salary_allocation",
                detail: "Worker persisted an approval-bound proposal in Azure SQL",
                state: "complete",
              },
            ]);
            break;
          }
        }
      }
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Salary event failed.");
    } finally {
      setEventPending(false);
    }
  }

  async function transcribe(audio: Blob) {
      setLoading(true);
      setError("");
      try {
        const form = new FormData();
        form.append("audio", audio, "request.webm");
        const response = await fetch("/api/voice/transcribe", {
          method: "POST",
          body: form,
        });
        const result = (await response.json()) as { text?: string; error?: string };
        if (!response.ok || !result.text) {
          throw new Error(result.error ?? "Voice transcription failed.");
        }
        setInput(result.text);
        await sendMessage(result.text);
      } catch (cause: unknown) {
        setError(
          cause instanceof Error ? cause.message : "Voice transcription failed.",
        );
      } finally {
        setLoading(false);
      }
    }

    async function toggleRecording() {
      if (recording) {
        recorderRef.current?.stop();
        setRecording(false);
        return;
      }
      setError("");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        audioChunksRef.current = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) audioChunksRef.current.push(event.data);
        };
        recorder.onstop = () => {
          stream.getTracks().forEach((track) => track.stop());
          const audio = new Blob(audioChunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });
          void transcribe(audio);
        };
        recorderRef.current = recorder;
        recorder.start();
        setRecording(true);
      } catch (cause: unknown) {
        setError(
          cause instanceof Error ? cause.message : "Microphone access failed.",
        );
      }
    }

    async function uploadInvoice(event: ChangeEvent<HTMLInputElement>) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setUploading(true);
      setError("");
      setSuccess(null);
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("personaId", personaId);
        const response = await fetch("/api/documents/invoice", {
          method: "POST",
          body: form,
        });
        const result = (await response.json()) as {
          merchant?: string;
          total?: number;
          currency?: string;
          intent?: ActionIntent;
          error?: string;
        };
        if (!response.ok || !result.intent) {
          throw new Error(result.error ?? "Invoice understanding failed.");
        }
        setAssistantOpen(true);
        setUserMessage(`Review the uploaded invoice: ${file.name}`);
        setAssistantMessage(
          `I extracted ${result.merchant} and ${result.total} ${result.currency}, checked the available balance, and prepared a payment for your approval.`,
        );
        setTraces([
          {
            id: "invoice-upload",
            name: "store_invoice",
            detail: "Encrypted invoice stored in Azure Blob Storage",
            state: "complete",
          },
          {
            id: "invoice-analysis",
            name: "analyze_invoice",
            detail: "Payee and total extracted by Azure AI Document Intelligence",
            state: "complete",
          },
        ]);
        setIntent(result.intent);
      } catch (cause: unknown) {
        setError(
          cause instanceof Error ? cause.message : "Invoice understanding failed.",
        );
      } finally {
        setUploading(false);
      }
    }

  function closeAssistant() {
    setAssistantOpen(false);
    setStatus(null);
    setTraces([]);
    setIntent(null);
    setSuccess(null);
    setAssistantMessage("");
    setConversationHistory([]);
    setSources([]);
    setEvidenceOpen(false);
    setError("");
  }

  function closeAdvisorMessages() {
    setAdvisorOpen(false);
    setAdvisorDraft(null);
    setApprovalOpen(false);
    setError("");
  }

  async function resetDemo() {
    if (
      !window.confirm(
        "Reset this browser's demo activity? The fixed banking history will remain.",
      )
    ) {
      return;
    }

    setResetting(true);
    setError("");
    try {
      const response = await fetch("/api/session/reset", { method: "POST" });
      if (!response.ok) throw new Error("Could not reset the demo session.");
      closeAssistant();
      closeAdvisorMessages();
      setAgentPlan(null);
      setActiveAccountIndex(0);
      setSelectedAccountId(null);
      const loaded = await loadDashboard(personaId);
      setDashboard(loaded.dashboard);
      setAdaptiveInsights(loaded.insights);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reset failed.");
    } finally {
      setResetting(false);
    }
  }

  function startTour() {
    stagedTourPromptRef.current = null;
    setTourPromptStaged(false);
    closeAssistant();
    closeAdvisorMessages();
    setAgentPlan(null);
    setSelectedAccountId(null);
    setActiveAccountIndex(0);
    if (activeTour.personaId) setPersonaId(activeTour.personaId);
    setTourStepIndex(0);
    setTourPaused(false);
    setTourRunning(true);
    setTourTargetFound(true);
  }

  function stopTour() {
    stagedTourPromptRef.current = null;
    setTourPromptStaged(false);
    setTourRunning(false);
    setTourPaused(false);
    setTourStepIndex(0);
    setTourTargetFound(true);
  }

  function moveTour(direction: -1 | 1) {
    stagedTourPromptRef.current = null;
    setTourPromptStaged(false);
    const next = tourStepIndex + direction;
    if (next < 0) return;
    if (next >= activeTour.steps.length) {
      stopTour();
      return;
    }
    setTourStepIndex(next);
    setTourPaused(false);
    setTourTargetFound(true);
  }

  async function runTourAction(action: TourAction) {
    if (action.kind === "prompt") {
      stagedTourPromptRef.current = {
        tourId: activeTourId,
        stepIndex: tourStepIndex,
      };
      setTourPromptStaged(true);
      setAssistantOpen(false);
      setAdvisorOpen(false);
      setSelectedAccountId(null);
      setInput(action.prompt);
      requestAnimationFrame(() => {
        const composer = document.querySelector<HTMLInputElement>(
          '[data-tour="command-input"]',
        );
        composer?.focus();
        composer?.setSelectionRange(action.prompt.length, action.prompt.length);
        composer?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } else if (action.kind === "open_account") {
      const account = dashboard?.accounts[action.accountIndex];
      if (account) {
        setAssistantOpen(false);
        setSelectedAccountId(account.id);
      }
    } else if (action.kind === "salary_event") {
      await triggerSalaryEvent();
    } else {
      const targetName =
        action.kind === "focus_voice"
          ? "voice-input"
          : action.kind === "focus_upload"
            ? "invoice-upload"
            : "reset-demo";
      document
        .querySelector<HTMLElement>(`[data-tour="${targetName}"]`)
        ?.focus();
    }
  }

  if (!dashboard) {
    return <main className="demo-shell">Loading Caldova…</main>;
  }

  const selectedAccount = dashboard.accounts.find(
    (account) => account.id === selectedAccountId,
  );
  const selectedTransactions = dashboard.transactions.filter(
    (transaction) => transaction.accountId === selectedAccountId,
  );
  const answerEvidence = sources;
  const guideCount = answerEvidence.filter(isDemoGuide).length;

  return (
    <main className="demo-shell">
      <section className="phone" aria-label="Caldova mobile banking demo">
        <header className="app-header">
          <div className="brand" aria-label="Caldova">
            <span className="brand-mark" aria-hidden="true">
              C
            </span>
            <span>Caldova</span>
          </div>
          <div className="profile-cluster">
            <select
              className="persona-select"
              data-tour="persona-selector"
              aria-label="Select demo customer"
              value={personaId}
              onChange={(event) => {
                closeAssistant();
                closeAdvisorMessages();
                setActiveAccountIndex(0);
                setSelectedAccountId(null);
                setAgentPlan(null);
                setPersonaId(event.target.value);
              }}
            >
              {personas.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.name}
                </option>
              ))}
            </select>
            <span className="profile-button" aria-hidden="true">
              {dashboard.persona.initials}
            </span>
          </div>
        </header>

        <div
          className="screen"
          ref={screenRef}
          onPointerDown={handleScreenPointerDown}
          onPointerMove={handleScreenPointerMove}
          onPointerUp={endScreenDrag}
          onPointerCancel={endScreenDrag}
          onClickCapture={handleScreenClickCapture}
        >
          <section
            className="home-view"
            aria-labelledby="homeGreeting"
            hidden={assistantOpen || advisorOpen || Boolean(selectedAccount)}
          >
            <div className="greeting-row">
              <div>
                <p className="eyebrow">Wednesday, 2 September</p>
                <h1 id="homeGreeting">
                  Good morning, {dashboard.persona.name.split(" ")[0]}
                </h1>
                <span className="mode-badge">
                  {dashboard.aiMode === "foundry"
                    ? "Live Microsoft Foundry"
                    : "Local fixture preview"}
                </span>
              </div>
              <button className="icon-button" type="button" aria-label="Notifications">
                <Icon name="bell" />
              </button>
            </div>

            <div
              className="account-carousel"
              data-tour="account-carousel"
              aria-label={`${dashboard.persona.name}'s accounts`}
              onPointerDown={handleCarouselPointerDown}
              onPointerMove={handleCarouselPointerMove}
              onPointerUp={endCarouselDrag}
              onPointerCancel={endCarouselDrag}
              onClickCapture={handleCarouselClickCapture}
              onScroll={handleAccountScroll}
            >
              {dashboard.accounts.map((account) => (
                <button
                  className={`balance-card balance-card--${account.type}`}
                  type="button"
                  key={account.id}
                  onClick={() => setSelectedAccountId(account.id)}
                  aria-label={`${account.name}, ${formatMoney(
                    account.balance,
                    account.currency,
                  )}`}
                >
                  <span className="card-topline">
                    <span>{account.name}</span>
                    <span className="visa">{account.network ?? "ACCOUNT"}</span>
                  </span>
                  <span className="balance">
                    {formatMoney(account.balance, account.currency)}
                  </span>
                  <span className="card-number">{account.maskedNumber}</span>
                </button>
              ))}
            </div>
            <div className="account-pagination" aria-hidden="true">
              {dashboard.accounts.map((account, index) => (
                <span
                  className={index === activeAccountIndex ? "active" : ""}
                  key={account.id}
                />
              ))}
            </div>

            <section className="quick-actions" aria-label="Quick actions">
              {[
                ["arrow", "Transfer"],
                ["receipt", "Pay"],
                ["swap", "Top up"],
                ["message", "Advisor"],
              ].map(([icon, label]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    if (label === "Advisor") {
                      void openAdvisorMessages();
                    } else if (label === "Transfer") {
                      const destination = dashboard.accounts.find(
                        (account) =>
                          account.id !== dashboard.account.id &&
                          account.currency === dashboard.account.currency &&
                          account.type === "savings",
                      ) ??
                        dashboard.accounts.find(
                          (account) =>
                            account.id !== dashboard.account.id &&
                            account.currency === dashboard.account.currency,
                        );
                      void sendMessage(
                        destination
                          ? `Move 100 ${dashboard.account.currency} from my ${dashboard.account.name} account to my ${destination.name}. Prepare it for my approval.`
                          : "Help me transfer money between my accounts.",
                      );
                    } else if (label === "Top up") {
                      void sendMessage(
                        "Top up my phone with the same amount as last time.",
                      );
                    } else {
                      void sendMessage(`Help me ${label.toLocaleLowerCase()}.`);
                    }
                  }}
                >
                  <span className="quick-icon">
                    <Icon name={icon} />
                  </span>
                  {label}
                </button>
              ))}
            </section>

            <section
              className="insight-section"
              aria-labelledby="insightTitle"
              data-tour="adaptive-insights"
            >
              <div className="section-heading">
                <div>
                  <p className="eyebrow">From your activity</p>
                  <h2 id="insightTitle">Worth a look</h2>
                </div>
                <span className="insight-swipe-hint">Swipe for more →</span>
              </div>
              <div
                className="insight-carousel"
                aria-label="Insights from your activity"
                onPointerDown={handleCarouselPointerDown}
                onPointerMove={handleCarouselPointerMove}
                onPointerUp={endCarouselDrag}
                onPointerCancel={endCarouselDrag}
                onClickCapture={handleCarouselClickCapture}
              >
                {adaptiveInsights.map((insight) => (
                  <button
                    type="button"
                    className={`insight-card insight-card--${insight.priority ?? "explore"}`}
                    key={`${insight.kind}-${insight.title}`}
                    onClick={() =>
                      void sendMessage(
                        insight.suggestedPrompt ?? "Explain this banking insight.",
                      )
                    }
                  >
                    <strong>{insight.title}</strong>
                    <span>{insight.summary}</span>
                    {insight.metrics[0] ? (
                      <small>
                        {insight.metrics[0].label}: {insight.metrics[0].value}
                      </small>
                    ) : null}
                    <span className="insight-link">See details →</span>
                  </button>
                ))}
              </div>
            </section>

            <section
              className="activity"
              aria-labelledby="activityTitle"
              data-tour="recent-activity"
            >
              <div className="section-heading">
                <h2 id="activityTitle">Recent activity</h2>
                <button
                  type="button"
                  onClick={() => void sendMessage("Show my recent transactions.")}
                >
                  Ask about these
                </button>
              </div>
              {dashboard.transactions
                .slice(0, 3)
                .map((transaction) => (
                  <TransactionRow
                    transaction={transaction}
                    key={transaction.id}
                  />
                ))}
            </section>
          </section>

          {selectedAccount && !assistantOpen && !advisorOpen ? (
            <section
              className="account-view"
              aria-labelledby="accountDetailsTitle"
            >
              <div className="account-detail-header">
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Back to accounts"
                  onClick={() => setSelectedAccountId(null)}
                >
                  <Icon name="back" />
                </button>
                <div>
                  <p className="eyebrow">Account activity</p>
                  <h2 id="accountDetailsTitle">{selectedAccount.name}</h2>
                </div>
              </div>
              <div
                className={`balance-card account-detail-card balance-card--${selectedAccount.type}`}
              >
                <span className="card-topline">
                  <span>{selectedAccount.name}</span>
                  <span className="visa">
                    {selectedAccount.network ?? "ACCOUNT"}
                  </span>
                </span>
                <span className="balance">
                  {formatMoney(
                    selectedAccount.balance,
                    selectedAccount.currency,
                  )}
                </span>
                <span className="card-number">
                  {selectedAccount.maskedNumber}
                </span>
              </div>
              <section
                className="account-transactions"
                aria-labelledby="accountTransactionsTitle"
              >
                <div className="section-heading">
                  <h3 id="accountTransactionsTitle">Transactions</h3>
                  <button
                    type="button"
                    onClick={() =>
                      void sendMessage(
                        `Explain the recent activity on my ${selectedAccount.name} account.`,
                      )
                    }
                  >
                    Ask assistant
                  </button>
                </div>
                {selectedTransactions.length > 0 ? (
                  <TransactionHistory transactions={selectedTransactions} />
                ) : (
                  <p className="empty-transactions">
                    No recent transactions on this account.
                  </p>
                )}
              </section>
            </section>
          ) : null}

          <section
            className="advisor-view"
            aria-labelledby="advisorTitle"
            hidden={!advisorOpen}
          >
            <div className="advisor-header">
              <button
                className="icon-button"
                type="button"
                aria-label="Back to banking"
                onClick={closeAdvisorMessages}
              >
                <Icon name="back" />
              </button>
              <div>
                <p className="eyebrow">Secure messages</p>
                <h2 id="advisorTitle">My advisor</h2>
              </div>
            </div>

            <div className="advisor-profile">
              <span className="advisor-avatar" aria-hidden="true">
                {dashboard?.persona.advisorInitials}
              </span>
              <span>
                <strong>{advisorName}</strong>
                <small>Your Caldova Bank advisor</small>
              </span>
            </div>

            <section className="advisor-thread" aria-label="Advisor messages">
              {advisorMessages.length > 0 ? (
                advisorMessages.map((message) => (
                  <article
                    className={`advisor-message advisor-message--${message.status}`}
                    key={message.id}
                  >
                    <span>{message.topic}</span>
                    <p>{message.body}</p>
                    <footer>
                      <small>
                        {message.status === "sent"
                          ? `Sent to ${advisorFirstName ?? "advisor"}`
                          : "Draft · not sent"}
                      </small>
                      {message.status === "draft" ? (
                        <button
                          type="button"
                          onClick={() => {
                            setAdvisorDraft(message);
                            setApprovalOpen(true);
                          }}
                        >
                          Review
                        </button>
                      ) : null}
                    </footer>
                  </article>
                ))
              ) : (
                <div className="advisor-empty">
                  <strong>No messages yet</strong>
                  <p>
                    Choose a topic and write what you want your advisor to know.
                    Nothing is sent until you approve the final text.
                  </p>
                </div>
              )}
            </section>

            <form
              className="advisor-compose"
              onSubmit={(event) => void prepareManualAdvisorDraft(event)}
            >
              <label htmlFor="advisorTopic">Topic</label>
              <select
                id="advisorTopic"
                value={advisorTopic}
                onChange={(event) =>
                  setAdvisorTopic(event.target.value as AdvisorTopic)
                }
              >
                {advisorTopics.map((topic) => (
                  <option key={topic} value={topic}>
                    {topic}
                  </option>
                ))}
              </select>
              <label htmlFor="advisorMessage">Message</label>
              <textarea
                id="advisorMessage"
                value={advisorText}
                onChange={(event) => setAdvisorText(event.target.value)}
                placeholder={`Write a message to ${advisorFirstName ?? "your advisor"}…`}
                rows={4}
                maxLength={1200}
              />
              <button
                className="primary-button full-width"
                type="submit"
                disabled={advisorBusy || !advisorText.trim()}
              >
                {advisorBusy ? "Preparing…" : "Review before sending"}
              </button>
            </form>
          </section>

          <section
            className="assistant-view"
            aria-labelledby="assistantTitle"
            hidden={!assistantOpen}
          >
            <div className="assistant-header">
              <button
                className="icon-button"
                type="button"
                aria-label="Close assistant"
                onClick={closeAssistant}
              >
                <Icon name="back" />
              </button>
              <div>
                <p className="eyebrow">Caldova assistant</p>
                <h2 id="assistantTitle">Let’s get it done</h2>
              </div>
              <span className="secure-badge">
                <Icon name="shield" />
                Controlled
              </span>
            </div>

            <div
              className="conversation"
              aria-live="polite"
            >
              {conversationHistory.map((turn, index) => (
                <div
                  key={`${turn.role}-${index}`}
                  ref={
                    turn.role === "assistant" &&
                    index === conversationHistory.length - 1
                      ? latestAnswerRef
                      : undefined
                  }
                  className={`message ${
                    turn.role === "user" ? "user-message" : "assistant-message"
                  }`}
                >
                  {turn.role === "assistant" ? (
                    <MarkdownMessage text={turn.content} />
                  ) : (
                    turn.content
                  )}
                </div>
              ))}
              {userMessage ? (
                <div className="message user-message">{userMessage}</div>
              ) : conversationHistory.length === 0 ? (
                <div className="conversation-empty">
                  Ask about your balance, a transaction, mobile top-up, bank
                  products, or salary planning.
                </div>
              ) : null}

              {assistantMessage && (
                <div
                  className="message assistant-message"
                  ref={latestAnswerRef}
                >
                  <MarkdownMessage text={assistantMessage} />
                </div>
              )}

              {!loading &&
                answerEvidence.length > 0 &&
                (assistantMessage ||
                  conversationHistory.at(-1)?.role === "assistant") && (
                <button
                  className="answer-evidence-link"
                  type="button"
                  ref={evidenceTriggerRef}
                  onClick={() => {
                    setApprovalOpen(false);
                    setEvidenceOpen(true);
                  }}
                >
                  <span aria-hidden="true">↗</span>
                  See the data behind this answer
                  <small>
                    {guideCount > 0
                      ? `${guideCount} ${guideCount === 1 ? "guide" : "guides"}`
                      : `${answerEvidence.length} ${answerEvidence.length === 1 ? "fact" : "facts"}`}
                  </small>
                </button>
              )}

              {agentPlan?.openQuestions.length ? (
                <div className="agent-input-needed">
                  <strong>Still needed from you</strong>
                  {agentPlan.openQuestions.map((question) => (
                    <p key={question}>{question}</p>
                  ))}
                </div>
              ) : null}

              {agentPlan?.scenarios.length ? (
                <div
                  className="agent-plan-scenarios result-scenarios"
                  data-tour="scenario-comparison"
                >
                  {agentPlan.scenarios.map((scenario) => (
                    <section key={scenario.id}>
                      <p>{scenario.label}</p>
                      <strong>{formatMoney(scenario.monthlyAmount)}/month</strong>
                      <span>{scenario.outcome}</span>
                      <small>{scenario.tradeoff}</small>
                    </section>
                  ))}
                </div>
              ) : null}

              {(status || traces.length > 0 || agentPlan || sources.length > 0) && (
                <details
                  className={`agent-process ${loading ? "processing" : ""}`}
                  data-tour="assistant-evidence"
                  open={loading || showProcessDetails || tourNeedsProcessDetails}
                  onToggle={(event) => {
                    if (!loading && !tourNeedsProcessDetails) {
                      setShowProcessDetails(event.currentTarget.open);
                    }
                  }}
                >
                  <summary>
                    <span className="agent-process-icon" aria-hidden="true">
                      {loading ? "…" : "✓"}
                    </span>
                    <span>
                      <strong>
                        {loading
                          ? "Working through your request"
                          : "How this answer was prepared"}
                      </strong>
                      <small>
                        {traces.filter((trace) => trace.state === "complete").length}{" "}
                        checks
                        {agentPlan
                          ? ` · ${agentPlan.evidence.length} grounded facts`
                          : sources.length > 0
                            ? ` · ${sources.length} sources`
                            : ""}
                      </small>
                    </span>
                    <Icon name="chevron" />
                  </summary>
                  <div className="agent-process-body">
                    {status && (
                      <div className="activity-update">
                        <span className="activity-marker running" aria-hidden="true">
                          <span />
                        </span>
                        <div>
                          <strong>{status.title}</strong>
                          <p>{status.detail}</p>
                        </div>
                      </div>
                    )}

                    {agentPlan && (
                      <section className="activity-update" data-tour="agent-plan">
                        <span className="activity-marker plan" aria-hidden="true">
                          <Icon name="spark" />
                        </span>
                        <div>
                          <strong>Approach</strong>
                          <p>{agentPlan.objective}</p>
                          <p className="activity-step">
                            {activePlanStep
                              ? `${
                                  activePlanStep.status === "blocked"
                                    ? "Needs input"
                                    : "Now"
                                }: ${activePlanStep.title}`
                              : `${completedPlanSteps} checks completed`}
                          </p>
                          {agentPlan.constraints.length > 0 && (
                            <p className="activity-constraints">
                              <span>Keeping in mind:</span>{" "}
                              {agentPlan.constraints.join(" · ")}
                            </p>
                          )}
                        </div>
                      </section>
                    )}

                    {traces.length > 0 && (
                      <ul className="tool-trace" aria-label="Actual agent activity">
                        {traces.map((trace) => (
                          <li key={trace.id}>
                            <span
                              className={`trace-state ${
                                trace.state === "running" ? "running" : ""
                              }`}
                              aria-hidden="true"
                            >
                              {trace.state === "complete" ? "✓" : "…"}
                            </span>
                            <span>
                              <strong>{humanizeTool(trace.name)}</strong>
                              {trace.detail}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                  </div>
                </details>
              )}

              {error && <div className="notice error-notice">{error}</div>}

              {advisorDraft && (
                <article className="advisor-draft-card fade-in">
                  <p className="eyebrow">Draft for your advisor</p>
                  <h3>{advisorDraft.topic}</h3>
                  <p>{advisorDraft.body}</p>
                  <small>Nothing has been sent.</small>
                  <button
                    className="primary-button full-width"
                    type="button"
                    onClick={() => setApprovalOpen(true)}
                  >
                    Review and approve
                  </button>
                </article>
              )}

              {intent && (
                <article
                  className="intent-card fade-in"
                  data-tour="approval-card"
                >
                  <div className="intent-heading">
                    <div>
                      <p className="eyebrow">Ready for your approval</p>
                      <h3>{intent.title}</h3>
                    </div>
                    <span className="intent-status">
                      {intent.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <dl className="intent-details">
                    {intent.fields.map((field) => (
                      <div key={field.label}>
                        <dt>{field.label}</dt>
                        <dd>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <button
                    className="explain-toggle"
                    type="button"
                    aria-expanded={showEvidence}
                    onClick={() => setShowEvidence((value) => !value)}
                  >
                    <span>
                      <Icon name="info" />
                      How this was prepared
                    </span>
                    <Icon name="chevron" />
                  </button>
                  <div className="explain-panel" hidden={!showEvidence}>
                    <ol>
                      {intent.evidence.map((item) => (
                        <li key={`${item.title}-${item.detail}`}>
                          <span className="check" aria-hidden="true">
                            ✓
                          </span>
                          <span>
                            <strong>{item.title}</strong>
                            {item.detail}
                          </span>
                        </li>
                      ))}
                    </ol>
                    <p>No payment happens until you approve it.</p>
                  </div>
                  <div className="approval-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setIntent(null)}
                    >
                      Not now
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={loading}
                      onClick={() => setApprovalOpen(true)}
                    >
                      Review and approve
                      <Icon name="next" />
                    </button>
                  </div>
                </article>
              )}

              {success && (
                <article className="success-card fade-in">
                  <div className="success-check" aria-hidden="true">
                    <Icon name="check" />
                  </div>
                  <p className="eyebrow">Completed</p>
                  <h3>{success.title}</h3>
                  <p>{success.receipt}</p>
                  {success.type === "salary_rule" ? (
                    <div className="new-balance">
                      <span>Automation status</span>
                      <strong>Rule activated</strong>
                    </div>
                  ) : success.type === "account_transfer" ? (
                    <div className="new-balance">
                      <span>
                        {dashboard.accounts.find(
                          (account) => account.id === success.sourceAccountId,
                        )?.name ?? "Source"}{" "}
                        ·{" "}
                        {formatMoney(
                          dashboard.accounts.find(
                            (account) => account.id === success.sourceAccountId,
                          )?.balance ?? 0,
                        )}
                      </span>
                      <strong>
                        {dashboard.accounts.find(
                          (account) =>
                            account.id === success.destinationAccountId,
                        )?.name ?? "Destination"}{" "}
                        ·{" "}
                        {formatMoney(
                          dashboard.accounts.find(
                            (account) =>
                              account.id === success.destinationAccountId,
                          )?.balance ?? 0,
                        )}
                      </strong>
                    </div>
                  ) : (
                    <div className="new-balance">
                      <span>Source account balance</span>
                      <strong>
                        {formatMoney(
                          dashboard.accounts.find(
                            (account) => account.id === success.sourceAccountId,
                          )?.balance ?? dashboard.account.balance,
                        )}
                      </strong>
                    </div>
                  )}
                  <button
                    className="primary-button full-width"
                    type="button"
                    onClick={closeAssistant}
                  >
                    Done
                  </button>
                </article>
              )}
            </div>
          </section>
        </div>

        <div
          className={`command-dock ${tourPromptStaged ? "is-tour-staged" : ""}`}
          data-tour="command-dock"
          hidden={advisorOpen}
        >
          <form onSubmit={submit}>
            <div className="dock-tools">
              <button
                className={`voice-button ${recording ? "recording" : ""}`}
                data-tour="voice-input"
                type="button"
                aria-label={recording ? "Stop voice input" : "Use voice input"}
                aria-pressed={recording}
                disabled={loading}
                onClick={() => void toggleRecording()}
              >
                <Icon name="mic" />
              </button>
              <label
                className={`file-button ${uploading ? "busy" : ""}`}
                data-tour="invoice-upload"
                tabIndex={0}
                aria-label="Upload invoice"
                aria-busy={uploading}
              >
                <Icon name="paperclip" />
                <input
                  type="file"
                  accept="image/*,.pdf"
                  disabled={uploading || loading}
                  onChange={(event) => void uploadInvoice(event)}
                />
              </label>
            </div>
            <label className="sr-only" htmlFor="commandInput">
              Ask Caldova
            </label>
            <input
              id="commandInput"
              data-tour="command-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask Caldova to do something…"
              autoComplete="off"
            />
            <button
              className="send-button"
              type="submit"
              aria-label="Send request"
              disabled={loading}
            >
              <Icon name="send" />
            </button>
          </form>
          <div
            className="prompt-suggestions"
            data-tour="prompt-suggestions"
            role="group"
            aria-label="Suggested requests"
            onPointerDown={handleCarouselPointerDown}
            onPointerMove={handleCarouselPointerMove}
            onPointerUp={endCarouselDrag}
            onPointerCancel={endCarouselDrag}
            onClickCapture={handleCarouselClickCapture}
          >
            {prompts.map((prompt) => (
              <button
                key={prompt.label}
                type="button"
                onClick={() => void sendMessage(prompt.prompt)}
              >
                {prompt.label}
              </button>
            ))}
          </div>
        </div>

        {approvalOpen && !loading && (intent || advisorDraft) ? (
          <ApprovalDialog
            key={intent?.id ?? advisorDraft!.id}
            title={intent?.title ?? `Send this message to ${advisorFirstName ?? "your advisor"}?`}
            eyebrow={intent ? "Approve banking action" : "Approve advisor message"}
            confirmLabel={intent ? "Slide to approve" : "Slide to send"}
            busy={approving}
            onCancel={() => setApprovalOpen(false)}
            onConfirm={
              intent
                ? approveIntentWithConfirmation
                : sendAdvisorDraftWithConfirmation
            }
          >
            {intent ? (
              <>
                <dl className="approval-review">
                  {intent.fields.map((field) => (
                    <div key={field.label}>
                      <dt>{field.label}</dt>
                      <dd>{field.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="approval-disclaimer">
                  This approves only the exact action shown above.
                </p>
              </>
            ) : (
              <>
                <div className="advisor-approval-copy">
                  <span>{advisorDraft!.topic}</span>
                  <p>{advisorDraft!.body}</p>
                </div>
                <p className="approval-disclaimer">
                  Sliding sends this exact topic and text to your advisor.
                </p>
              </>
            )}
          </ApprovalDialog>
        ) : null}
        {evidenceOpen && (
          <EvidenceSheet
            evidence={answerEvidence}
            onClose={() => {
              setEvidenceOpen(false);
              requestAnimationFrame(() => evidenceTriggerRef.current?.focus());
            }}
          />
        )}
      </section>

      <aside className="demo-notes" aria-labelledby="demoNotesTitle">
        <div>
          <p className="eyebrow">Live board demo · customer controlled</p>
          <h2 id="demoNotesTitle">
            <span>From words to a</span>
            <span>safe banking action.</span>
          </h2>
          <p>
            Every step shown in the phone comes from a real model, retrieval,
            tool, policy, approval, or execution event.
          </p>
          <div className="demo-reset" data-tour="reset-demo">
            <span>
              <strong>Start fresh</strong>
              Clear only this browser&apos;s demo activity while preserving the
              fixed customer history.
            </span>
            <button
              type="button"
              disabled={resetting}
              onClick={() => void resetDemo()}
            >
              {resetting ? "Resetting..." : "Reset demo"}
            </button>
          </div>
        </div>
        <section
          className="tour-navigator"
          aria-labelledby="tourNavigatorTitle"
          aria-live="polite"
        >
          <div className="tour-heading">
            <div>
              <p className="eyebrow">Narration navigator</p>
              <h3 id="tourNavigatorTitle">Guided experiences</h3>
            </div>
            <span>{guidedTours.length} tours</span>
          </div>
          <label className="tour-selector-label" htmlFor="tourSelector">
            Choose a journey
          </label>
          <select
            id="tourSelector"
            className="tour-selector"
            value={activeTourId}
            onChange={(event) => {
              stagedTourPromptRef.current = null;
              setActiveTourId(event.target.value);
              setTourPromptStaged(false);
              setTourStepIndex(0);
              setTourRunning(false);
              setTourPaused(false);
            }}
          >
            {(["Essentials", "AI transformation"] as const).map((category) => (
              <optgroup label={category} key={category}>
                {guidedTours
                  .filter((tour) => tour.category === category)
                  .map((tour) => (
                    <option value={tour.id} key={tour.id}>
                      {tour.title}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>

          {!tourRunning ? (
            <div className="tour-preview">
              <span>
                {activeTour.category} · {activeTour.duration}
              </span>
              <strong>{activeTour.title}</strong>
              <p>{activeTour.summary}</p>
              <button type="button" onClick={startTour}>
                <Icon name="spark" />
                Start guided tour
              </button>
            </div>
          ) : (
            <div className="tour-step-card" role="dialog" aria-modal="false">
              <div className="tour-progress-row">
                <span>
                  Step {tourStepIndex + 1} of {activeTour.steps.length}
                </span>
                <button type="button" onClick={stopTour}>
                  Exit
                </button>
              </div>
              <div
                className="tour-progress"
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={activeTour.steps.length}
                aria-valuenow={tourStepIndex + 1}
              >
                <span
                  style={{
                    width: `${((tourStepIndex + 1) / activeTour.steps.length) * 100}%`,
                  }}
                />
              </div>
              <p className="eyebrow">{activeTour.title}</p>
              <h4>{activeTourStep.title}</h4>
              <p>{activeTourStep.narration}</p>
              {!tourTargetFound ? (
                <p className="tour-target-note">
                  The live target is not visible yet. Run the step or continue; the
                  tour remains available.
                </p>
              ) : null}
              {activeTourStep.action ? (
                <button
                  className="tour-action"
                  data-tour={
                    activeTourStep.action.kind === "salary_event"
                      ? "salary-event"
                      : undefined
                  }
                  type="button"
                  disabled={loading || eventPending}
                  onClick={() => void runTourAction(activeTourStep.action!)}
                >
                  {activeTourStep.action.kind === "prompt"
                    ? "Copy prompt to input"
                    : activeTourStep.actionLabel ?? "Run this step"}
                  <Icon name="next" />
                </button>
              ) : null}
              <div className="tour-controls">
                <button
                  type="button"
                  disabled={tourStepIndex === 0}
                  onClick={() => moveTour(-1)}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setTourPaused((value) => !value)}
                >
                  {tourPaused ? "Resume" : "Pause"}
                </button>
                <button type="button" onClick={() => moveTour(1)}>
                  {tourStepIndex === activeTour.steps.length - 1
                    ? "Finish"
                    : "Next"}
                </button>
              </div>
            </div>
          )}
        </section>
      </aside>
    </main>
  );
}

function EvidenceSheet({
  evidence,
  onClose,
}: {
  evidence: Evidence[];
  onClose: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const selected = evidence[selectedIndex];

  useEffect(() => {
    closeRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), summary, a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!selected) return null;

  return (
    <div
      className="evidence-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="evidence-sheet"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidenceSheetTitle"
      >
        <div className="evidence-sheet-header">
          <div>
            <p className="eyebrow">Behind the answer</p>
            <h2 id="evidenceSheetTitle">Sources &amp; data</h2>
          </div>
          <button
            className="approval-close"
            type="button"
            ref={closeRef}
            aria-label="Close sources and data"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="evidence-sheet-intro">
          Inspect the records and guides checked for this answer.
        </p>
        <div className="evidence-sheet-body">
          <nav className="evidence-picker" aria-label="Choose a source">
            {evidence.map((item, index) => (
              <button
                type="button"
                key={`${item.title}-${item.source ?? ""}-${index}`}
                className={index === selectedIndex ? "selected" : ""}
                aria-current={index === selectedIndex ? "true" : undefined}
                onClick={() => setSelectedIndex(index)}
              >
                <span>{isDemoGuide(item) ? "Guide" : "Banking data"}</span>
                <strong>{item.title}</strong>
              </button>
            ))}
          </nav>
          <article className="evidence-record" aria-live="polite">
            <p className="eyebrow">
              {isDemoGuide(selected) ? "Guide" : selected.source ?? "Banking data"}
            </p>
            <h3>{selected.title}</h3>
            <div className="evidence-passage">
              <span>{isDemoGuide(selected) ? "Retrieved passage" : "Checked fact"}</span>
              <p>
                {selected.detail}
                {selected.document && selected.detail.length < selected.document.length
                  ? "…"
                  : ""}
              </p>
            </div>
            {isDemoGuide(selected) ? (
              <>
                {selected.document && (
                  <details className="evidence-full-document">
                    <summary>Read the full guide</summary>
                    <div className="evidence-document-text">
                      <MarkdownMessage text={selected.document} />
                    </div>
                  </details>
                )}
                <p className="evidence-disclaimer">
                  Reference content, not current product terms.
                </p>
              </>
            ) : (
              <p className="evidence-disclaimer">
                From this customer&apos;s sample banking records.
              </p>
            )}
          </article>
        </div>
      </section>
    </div>
  );
}

function isDemoGuide(source: Evidence) {
  return source.source === "Caldova policy knowledge";
}

function ApprovalDialog({
  eyebrow,
  title,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
  children,
}: {
  eyebrow: string;
  title: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  children: ReactNode;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startOffset: number;
  } | null>(null);
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);
  const [maximum, setMaximum] = useState(1);
  const maximumRef = useRef(1);

  function updateOffset(value: number) {
    offsetRef.current = value;
    setOffset(value);
  }

  function measureMaximum() {
    const rail = railRef.current;
    const value = rail ? Math.max(1, rail.clientWidth - 58) : 1;
    maximumRef.current = value;
    setMaximum(value);
    return value;
  }

  function startSlide(event: ReactPointerEvent<HTMLDivElement>) {
    if (busy) return;
    event.stopPropagation();
    event.preventDefault();
    measureMaximum();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startOffset: offsetRef.current,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveSlide(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || busy) return;
    event.stopPropagation();
    updateOffset(
      Math.min(
        maximumRef.current,
        Math.max(0, drag.startOffset + event.clientX - drag.startX),
      ),
    );
    event.preventDefault();
  }

  function finishSlide(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const measuredMaximum = measureMaximum();
    if (offsetRef.current / measuredMaximum >= 0.92) {
      updateOffset(measuredMaximum);
      void onConfirm();
    } else {
      updateOffset(0);
    }
  }

  function cancelSlide(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    updateOffset(0);
  }

  function handleSliderKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (busy) return;
    const measuredMaximum = measureMaximum();
    const step = Math.max(18, measuredMaximum / 8);
    if (event.key === "ArrowRight") {
      updateOffset(Math.min(measuredMaximum, offsetRef.current + step));
      event.preventDefault();
    } else if (event.key === "ArrowLeft") {
      updateOffset(Math.max(0, offsetRef.current - step));
      event.preventDefault();
    } else if (
      event.key === "Enter" &&
      offsetRef.current / measuredMaximum >= 0.92
    ) {
      void onConfirm();
      event.preventDefault();
    }
  }

  const progress = offset / maximum;

  return (
    <div className="approval-overlay" role="presentation">
      <section
        className="approval-dialog"
        data-tour="approval-screen"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approvalDialogTitle"
      >
        <div className="approval-dialog-heading">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 id="approvalDialogTitle">{title}</h2>
          </div>
          <button
            type="button"
            className="approval-close"
            aria-label="Close approval"
            disabled={busy}
            onClick={onCancel}
          >
            ×
          </button>
        </div>
        <div className="approval-dialog-body">{children}</div>
        <div
          className={`slide-approval ${busy ? "busy" : ""}`}
          ref={railRef}
          style={
            { "--slide-progress": `${progress * 100}%` } as CSSProperties
          }
        >
          <span>{busy ? "Approving…" : confirmLabel}</span>
          <div
            className="slide-handle"
            role="slider"
            tabIndex={busy ? -1 : 0}
            aria-label={confirmLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-valuetext={
              progress >= 0.92 ? "Ready. Press Enter to confirm." : "Not approved"
            }
            style={{ transform: `translateX(${offset}px)` }}
            onPointerDown={startSlide}
            onPointerMove={moveSlide}
            onPointerUp={finishSlide}
            onPointerCancel={cancelSlide}
            onKeyDown={handleSliderKey}
          >
            <Icon name={progress >= 0.92 ? "check" : "next"} />
          </div>
        </div>
        <p className="slide-help">
          Press and drag the white handle all the way right. Tapping it will not
          approve or send.
        </p>
      </section>
    </div>
  );
}

function TransactionRow({ transaction }: { transaction: Transaction }) {
  return (
    <div className="transaction">
      <span
        className={`transaction-logo ${
          transaction.direction === "credit" ? "salary" : "kyivstar"
        }`}
        aria-hidden="true"
      >
        {transaction.merchant.charAt(0)}
      </span>
      <span>
        <strong>{transaction.merchant}</strong>
        <small>
          {formatDate(transaction.bookedAt)} · {transaction.category}
        </small>
      </span>
      <strong
        className={`transaction-amount ${
          transaction.direction === "credit" ? "positive" : ""
        }`}
      >
        {transaction.direction === "credit" ? "+" : "−"}{" "}
        {formatMoney(transaction.amount, transaction.currency)}
      </strong>
    </div>
  );
}

function TransactionHistory({ transactions }: { transactions: Transaction[] }) {
  const groups = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const month = new Intl.DateTimeFormat("en", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(transaction.bookedAt));
    groups.set(month, [...(groups.get(month) ?? []), transaction]);
  }

  return [...groups.entries()].map(([month, items]) => (
    <div className="transaction-month-group" key={month}>
      <h4>{month}</h4>
      {items.map((transaction) => (
        <TransactionRow transaction={transaction} key={transaction.id} />
      ))}
    </div>
  ));
}

type MarkdownBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "unordered-list" | "ordered-list"; items: string[] };

function MarkdownMessage({ text }: { text: string }) {
  return parseMarkdownBlocks(text).map((block, index) => {
    if (block.kind === "heading") {
      return <h3 key={index}>{renderInlineMarkdown(block.text)}</h3>;
    }
    if (block.kind === "paragraph") {
      return <p key={index}>{renderInlineMarkdown(block.text)}</p>;
    }
    const List = block.kind === "ordered-list" ? "ol" : "ul";
    return (
      <List key={index}>
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
        ))}
      </List>
    );
  });
}

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let listKind: "unordered-list" | "ordered-list" | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listKind) {
      blocks.push({ kind: listKind, items: listItems });
      listKind = null;
      listItems = [];
    }
  };

  for (const rawLine of text.replaceAll("\r\n", "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", text: heading[1] });
      continue;
    }
    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const kind = ordered ? "ordered-list" : "unordered-list";
      if (listKind !== kind) {
        flushList();
        listKind = kind;
      }
      listItems.push((unordered ?? ordered)![1]);
      continue;
    }
    if (listKind) {
      listItems[listItems.length - 1] += ` ${line}`;
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  return text
    .split(/(\*\*.+?\*\*|`.+?`|\*[^*]+?\*)/g)
    .filter(Boolean)
    .map((token, index) => {
      if (token.startsWith("**") && token.endsWith("**")) {
        return <strong key={index}>{token.slice(2, -2)}</strong>;
      }
      if (token.startsWith("`") && token.endsWith("`")) {
        return <code key={index}>{token.slice(1, -1)}</code>;
      }
      if (token.startsWith("*") && token.endsWith("*")) {
        return <em key={index}>{token.slice(1, -1)}</em>;
      }
      return token;
    });
}

function formatMoney(
  amount: number,
  currency: Dashboard["account"]["currency"] = "UAH",
) {
  return new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  })
    .format(amount)
    .replace("грн", "₴")
    .trim();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function humanizeTool(name: string) {
  return name
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    bell: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />,
    arrow: <path d="m7 17 10-10M8 7h9v9" />,
    receipt: <path d="M6 5h12v14H6zM9 9h6M9 13h3" />,
    swap: <path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5" />,
    back: <path d="m15 18-6-6 6-6" />,
    shield: <path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6zM9 12l2 2 4-4" />,
    info: <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 11v6M12 7h.01" />,
    chevron: <path d="m6 9 6 6 6-6" />,
    next: <path d="m9 18 6-6-6-6" />,
    check: <path d="m6 12 4 4 8-8" />,
    mic: <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />,
    paperclip: <path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8" />,
    send: <path d="m5 12 14-7-4 14-3-6z" />,
    message: <path d="M4 5h16v11H8l-4 4zM8 9h8M8 12h5" />,
    spark: <path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4zM18 16l.7 2.3L21 19l-2.3.7L18 22l-.7-2.3L15 19l2.3-.7z" />,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
