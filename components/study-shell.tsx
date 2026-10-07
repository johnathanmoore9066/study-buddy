"use client";

import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import {
  CSSProperties,
  FormEvent,
  Fragment,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CosmosPick } from "@/components/universe-engine";
import {
  STATUS_COLORS,
  STARTER_EDGES,
  STARTER_NODES,
  statusLabel,
} from "@/lib/concepts";
import { buildCosmos } from "@/lib/cosmos";
import {
  MASTERED_AT,
  nextMastery,
  resolveConceptId,
  resolveDomain,
  settleConcept,
  struggleStreak,
  summarizeMap,
} from "@/lib/learning";
import { PROVIDERS, providerName } from "@/lib/providers";
import { DEPTH_LABELS } from "@/lib/system-prompt";
import type {
  ChatMessage,
  ConceptEdge,
  ConceptNode,
  ConceptStatus,
  DepthLevel,
  ProviderConfig,
  ProviderId,
  TutorResponse,
} from "@/lib/types";
import { AsterMark, Icon } from "@/components/icons";

const SkillUniverse = dynamic(
  () => import("@/components/skill-universe").then((module) => module.SkillUniverse),
  {
    ssr: false,
    loading: () => (
      <div className="universe-loading" role="status">
        <span className="orbit-spinner" aria-hidden="true">
          <i />
        </span>
        Charting the sky
      </div>
    ),
  },
);

const STORAGE_KEY = "aster-session-v1";
const PROVIDER_STORAGE_KEY = "aster-provider-v1";
const SESSION_KEY = "aster-session-api-key";

const DEFAULT_PROVIDER: ProviderConfig = {
  id: "deepseek",
  model: "deepseek-v4-pro",
  apiKey: "",
  remember: true,
};

const STATUS_ORDER: ConceptStatus[] = ["learning", "mastered", "suggested", "locked"];

// One source of truth for status colours: the WebGL scene reads STATUS_COLORS
// directly and the stylesheet reads these custom properties.
const STATUS_TOKENS = {
  "--status-learning": STATUS_COLORS.learning,
  "--status-mastered": STATUS_COLORS.mastered,
  "--status-suggested": STATUS_COLORS.suggested,
  "--status-locked": STATUS_COLORS.locked,
} as CSSProperties;

const STARTER_MESSAGES: ChatMessage[] = [
  {
    id: "demo-1",
    role: "assistant",
    content:
      "Let’s stay with the limit you brought in: (x² − 4) / (x − 2) as x approaches 2. You noticed direct substitution gives 0/0. That is an important signal, but it is not yet a conclusion. What does x² − 4 factor into?",
    timestamp: "10:42",
  },
  {
    id: "demo-2",
    role: "user",
    content: "I think it’s (x − 2)(x + 2).",
    timestamp: "10:43",
  },
  {
    id: "demo-3",
    role: "assistant",
    content:
      "Yes, the factorization is right, and it exposes why substitution looked broken. For every x near 2 except x = 2, the shared (x − 2) can be removed. After that cancellation, what value does the remaining expression approach?",
    timestamp: "10:43",
  },
];

// Replies ending in an ellipsis are sentence starters: they go into the
// composer for the learner to finish rather than being sent as they are.
const STARTER_QUICK_REPLIES = [
  "After cancelling, it becomes…",
  "Why are we allowed to cancel it?",
  "I’m still stuck on 0/0.",
];

const FRESH_SESSION_REPLIES = [
  "Here’s my homework problem:…",
  "I want to learn about…",
  "Help me prepare for an exam on…",
];

function isSentenceStarter(reply: string) {
  return /(…|\.\.\.)$/.test(reply);
}

function newId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function timeLabel() {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
}

function isNode(node: ConceptNode | undefined): node is ConceptNode {
  return Boolean(node);
}

function EvidenceGauge({ value, label }: { value: number; label: string }) {
  const radius = 23;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      className="evidence-gauge"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <svg viewBox="0 0 60 60" aria-hidden="true">
        <circle className="evidence-gauge__track" cx="30" cy="30" r={radius} />
        <circle
          className="evidence-gauge__arc"
          cx="30"
          cy="30"
          r={radius}
          transform="rotate(-90 30 30)"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value / 100)}
        />
        <g
          className="evidence-gauge__body"
          style={{ transform: `rotate(${value * 3.6}deg)` }}
        >
          <circle cx="30" cy={30 - radius} r="3.4" />
        </g>
      </svg>
      <strong>{value}%</strong>
      <small>evidence</small>
    </div>
  );
}

function BodyChip({
  node,
  onSelect,
}: {
  node: ConceptNode;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="body-chip"
      data-status={node.status}
      onClick={() => onSelect(node.id)}
    >
      <i aria-hidden="true" />
      {node.label}
    </button>
  );
}

export function StudyShell() {
  const [messages, setMessages] = useState<ChatMessage[]>(STARTER_MESSAGES);
  const [nodes, setNodes] = useState<ConceptNode[]>(STARTER_NODES);
  const [edges, setEdges] = useState<ConceptEdge[]>(STARTER_EDGES);
  const [selectedId, setSelectedId] = useState("factoring");
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null);
  const [depth, setDepth] = useState<DepthLevel>(3);
  const [input, setInput] = useState("");
  const [quickReplies, setQuickReplies] = useState(STARTER_QUICK_REPLIES);
  const [assignmentContext, setAssignmentContext] = useState("");
  const [contextDraft, setContextDraft] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [provider, setProvider] =
    useState<ProviderConfig>(DEFAULT_PROVIDER);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [mobilePane, setMobilePane] = useState<"chat" | "universe">("chat");
  const [dossierOpen, setDossierOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          messages?: ChatMessage[];
          nodes?: ConceptNode[];
          edges?: ConceptEdge[];
          selectedId?: string;
          depth?: DepthLevel;
          assignmentContext?: string;
          quickReplies?: string[];
        };
        if (Array.isArray(parsed.messages) && parsed.messages.length) {
          setMessages(parsed.messages);
        }
        if (Array.isArray(parsed.nodes)) {
          setNodes(parsed.nodes);
        }
        if (Array.isArray(parsed.edges)) {
          setEdges(parsed.edges);
        }
        if (typeof parsed.selectedId === "string") {
          setSelectedId(parsed.selectedId);
        }
        if ([1, 2, 3, 4, 5].includes(Number(parsed.depth))) {
          setDepth(parsed.depth as DepthLevel);
        }
        if (typeof parsed.assignmentContext === "string") {
          setAssignmentContext(parsed.assignmentContext);
          setContextDraft(parsed.assignmentContext);
        }
        if (Array.isArray(parsed.quickReplies)) {
          setQuickReplies(
            parsed.quickReplies.filter(
              (reply): reply is string => typeof reply === "string",
            ),
          );
        }
      }
      const savedProvider = localStorage.getItem(PROVIDER_STORAGE_KEY);
      if (savedProvider) {
        const parsed = JSON.parse(savedProvider) as Partial<ProviderConfig>;
        const apiKey =
          parsed.remember === false
            ? sessionStorage.getItem(SESSION_KEY) ?? ""
            : typeof parsed.apiKey === "string"
              ? parsed.apiKey
              : "";
        setProvider({
          id: parsed.id ?? DEFAULT_PROVIDER.id,
          model: parsed.model ?? DEFAULT_PROVIDER.model,
          baseUrl: parsed.baseUrl ?? "",
          remember: parsed.remember ?? true,
          apiKey,
        });
        if (!apiKey) setSettingsOpen(true);
      } else {
        setSettingsOpen(true);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const saved = {
      id: provider.id,
      model: provider.model,
      baseUrl: provider.baseUrl,
      remember: provider.remember,
      apiKey: provider.remember ? provider.apiKey : "",
    };
    localStorage.setItem(PROVIDER_STORAGE_KEY, JSON.stringify(saved));
    if (provider.remember) {
      sessionStorage.removeItem(SESSION_KEY);
    } else if (provider.apiKey) {
      sessionStorage.setItem(SESSION_KEY, provider.apiKey);
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }, [hydrated, provider]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        messages,
        nodes,
        edges,
        selectedId,
        depth,
        assignmentContext,
        quickReplies,
      }),
    );
  }, [
    assignmentContext,
    depth,
    edges,
    hydrated,
    messages,
    nodes,
    quickReplies,
    selectedId,
  ]);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTo({
      top: thread.scrollHeight,
      behavior: pending ? "smooth" : "auto",
    });
  }, [messages, pending]);

  const focusNode = useMemo(
    () =>
      nodes.find((node) => node.status === "learning") ??
      nodes.find((node) => node.id === selectedId) ??
      nodes[0],
    [nodes, selectedId],
  );

  const sessionIsFresh = useMemo(
    () => !messages.some((message) => message.role === "user"),
    [messages],
  );

  const selectedNode = useMemo(
    () =>
      nodes.find((node) => node.id === selectedId) ??
      focusNode,
    [focusNode, nodes, selectedId],
  );

  const masteredCount = useMemo(
    () => nodes.filter((node) => node.status === "mastered").length,
    [nodes],
  );

  const cosmos = useMemo(() => buildCosmos(nodes, edges), [edges, nodes]);

  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  const systemByKey = useMemo(
    () => new Map(cosmos.systems.map((system) => [system.key, system])),
    [cosmos],
  );

  const selection = useMemo<CosmosPick | null>(() => {
    if (selectedSystem && systemByKey.has(selectedSystem)) {
      return { kind: "system", key: selectedSystem };
    }
    return selectedNode ? { kind: "body", id: selectedNode.id } : null;
  }, [selectedNode, selectedSystem, systemByKey]);

  const selectedBody = selectedNode
    ? cosmos.bodies.get(selectedNode.id)
    : undefined;
  const viewedSystem =
    selection?.kind === "system"
      ? systemByKey.get(selection.key)
      : selectedBody
        ? systemByKey.get(selectedBody.systemKey)
        : undefined;
  const hostNode = selectedBody?.hostId
    ? nodeById.get(selectedBody.hostId)
    : undefined;
  const moonNodes = (selectedBody?.moonIds ?? [])
    .map((id) => nodeById.get(id))
    .filter(isNode);

  const connections = useMemo(
    () =>
      selectedNode
        ? edges
            .filter(
              (edge) =>
                edge.to === selectedNode.id && edge.from !== selectedBody?.hostId,
            )
            .map((edge) => nodeById.get(edge.from))
            .filter(isNode)
            .slice(0, 4)
        : [],
    [edges, nodeById, selectedBody?.hostId, selectedNode],
  );

  const describePlace = (id: string) => {
    const body = cosmos.bodies.get(id);
    const system = body ? systemByKey.get(body.systemKey) : undefined;
    if (!body || !system) return "";
    if (body.kind === "moon") {
      const host = nodeById.get(body.hostId ?? "");
      return `Moon of ${host?.label ?? "a planet"} · ${system.label}`;
    }
    return `Planet in the ${system.label} system`;
  };

  const graphSummary = useMemo(
    () => summarizeMap(nodes, edges, sessionIsFresh ? "" : (focusNode?.id ?? "")),
    [edges, focusNode?.id, nodes, sessionIsFresh],
  );

  const mergeTutorState = useCallback(
    (response: TutorResponse) => {
      const resolve = (id: string, label: string) => resolveConceptId(nodes, id, label);
      const focusId = resolve(response.focus.id, response.focus.label);
      const related = response.related
        .map((item) => ({
          ...item,
          id: resolve(item.id, item.label),
          domain: resolveDomain(nodes, item.domain),
        }))
        .filter((item) => item.id !== focusId);
      const milestone = response.milestone;
      const evidenced = new Set(
        (milestone?.masteredConcepts ?? [])
          .map((id) => resolve(id, id.replace(/-/g, " ")))
          .filter((id) => id !== focusId),
      );

      setNodes((previous) => {
        const existingFocus = previous.find((node) => node.id === focusId);
        const focusMastery = nextMastery({
          previous: existingFocus?.mastery,
          proposed: response.focus.mastery,
          learnerState: response.learnerState,
          milestone: Boolean(milestone),
        });
        const insights = (current: ConceptNode["insights"]) =>
          milestone
            ? [
                ...(current ?? []).filter(
                  (insight) =>
                    insight.title !== milestone.title ||
                    insight.summary !== milestone.summary,
                ),
                milestone,
              ].slice(-8)
            : current;

        // Concepts already on the map keep their label and subject, so a planet
        // is never renamed or moved to another star system mid-conversation.
        const next = previous.map((node): ConceptNode => {
          if (node.id === focusId) {
            return {
              ...node,
              status: "learning",
              mastery: focusMastery,
              evidence: response.focus.evidence || node.evidence,
              insights: insights(node.insights),
            };
          }
          return settleConcept(node, evidenced.has(node.id));
        });

        if (!existingFocus) {
          next.push({
            id: focusId,
            label: response.focus.label,
            domain: resolveDomain(previous, response.focus.domain),
            description: response.focus.description,
            status: "learning",
            mastery: focusMastery,
            evidence: response.focus.evidence || undefined,
            insights: insights(undefined),
          });
        }

        related.forEach((item) => {
          const index = next.findIndex((node) => node.id === item.id);
          if (index < 0) {
            next.push({
              id: item.id,
              label: item.label,
              domain: item.domain,
              description: item.description,
              status: item.status,
              mastery: 0,
            });
          } else if (next[index].status === "locked" && item.status === "suggested") {
            // Readiness only moves closer; a concept never drifts back out of reach.
            next[index] = { ...next[index], status: "suggested" };
          }
        });

        return next;
      });

      setEdges((previous) => {
        const next = [...previous];
        related.forEach((item) => {
          const from = item.relation === "prerequisite" ? item.id : focusId;
          const to = item.relation === "prerequisite" ? focusId : item.id;
          if (!next.some((edge) => edge.from === from && edge.to === to)) {
            next.push({ from, to, relation: item.relation });
          }
        });
        return next;
      });

      setSelectedId(focusId);
      setSelectedSystem(null);
      setQuickReplies(response.quickReplies);
    },
    [nodes],
  );

  const requestTutor = useCallback(
    async (conversation: ChatMessage[]) => {
      setPending(true);
      setError("");
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: conversation,
            depth,
            focus:
              sessionIsFresh || !focusNode
                ? null
                : {
                    id: focusNode.id,
                    label: focusNode.label,
                    evidence: focusNode.mastery,
                    insights: (focusNode.insights ?? []).map((insight) => insight.title),
                  },
            struggleStreak: struggleStreak(conversation),
            assignmentContext,
            graphSummary,
            provider,
          }),
        });

        const result = (await response.json()) as TutorResponse & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(result.error || "The tutor could not respond.");
        }

        setMessages((previous) => [
          ...previous,
          {
            id: newId("assistant"),
            role: "assistant",
            content: result.reply,
            timestamp: timeLabel(),
            milestone: result.milestone,
            learnerState: result.learnerState ?? undefined,
          },
        ]);
        mergeTutorState(result);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "The tutor could not respond. Try again.",
        );
      } finally {
        setPending(false);
      }
    },
    [
      assignmentContext,
      depth,
      focusNode,
      graphSummary,
      mergeTutorState,
      provider,
      sessionIsFresh,
    ],
  );

  const sendMessage = useCallback(
    async (rawMessage: string) => {
      const content = rawMessage.trim();
      if (!content || pending) return;
      if (!provider.apiKey.trim()) {
        setSettingsOpen(true);
        return;
      }
      const userMessage: ChatMessage = {
        id: newId("user"),
        role: "user",
        content,
        timestamp: timeLabel(),
      };
      const conversation = [...messages, userMessage];
      setMessages(conversation);
      setInput("");
      setQuickReplies([]);
      await requestTutor(conversation);
    },
    [messages, pending, provider.apiKey, requestTutor],
  );

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage(input);
  };

  const handleComposerKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (input.trim()) void sendMessage(input);
    }
  };

  // Setting a textarea's value leaves the caret at the end, so focusing now is
  // enough for the learner to keep typing where the starter stops.
  const startReply = (starter: string) => {
    setInput(`${starter.replace(/\s*(…|\.\.\.)$/, "")} `);
    textAreaRef.current?.focus();
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    const cleanText = text.slice(0, 36_000);
    setContextDraft(cleanText);
    setContextOpen(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const openContext = () => {
    setContextDraft(assignmentContext);
    setContextOpen(true);
  };

  const saveContext = () => {
    setAssignmentContext(contextDraft.trim());
    setContextOpen(false);
  };

  const startNewSession = () => {
    const welcome: ChatMessage = {
      id: newId("assistant"),
      role: "assistant",
      content:
        "New trail, same universe. What are we exploring next? Start anywhere. If it connects to something you already know, we’ll let that bridge reveal itself naturally.",
      timestamp: timeLabel(),
    };
    const preservedNodes = nodes.map((node) =>
      node.status === "learning"
        ? {
            ...node,
            status:
              node.mastery >= MASTERED_AT
                ? ("mastered" as const)
                : ("suggested" as const),
          }
        : node,
    );

    setMessages([welcome]);
    setNodes(preservedNodes);
    setQuickReplies(FRESH_SESSION_REPLIES);
    setAssignmentContext("");
    setContextDraft("");
    setInput("");
    setError("");
    setSelectedSystem(null);
    setMobilePane("chat");
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        messages: [welcome],
        nodes: preservedNodes,
        edges,
        selectedId,
        depth,
        assignmentContext: "",
        quickReplies: FRESH_SESSION_REPLIES,
      }),
    );
  };

  const resetLearning = () => {
    const welcome: ChatMessage = {
      id: newId("assistant"),
      role: "assistant",
      content:
        "Blank slate, open sky. What are we untangling today? Drop in the topic, problem, or your messiest first thought. I’ll help you find the next step without taking the thinking away from you.",
      timestamp: timeLabel(),
    };
    setMessages([welcome]);
    setNodes([]);
    setEdges([]);
    setSelectedId("");
    setSelectedSystem(null);
    const blankSlateReplies = FRESH_SESSION_REPLIES;
    setQuickReplies(blankSlateReplies);
    setAssignmentContext("");
    setContextDraft("");
    setError("");
    setMobilePane("chat");
    setResetOpen(false);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        messages: [welcome],
        nodes: [],
        edges: [],
        selectedId: "",
        depth,
        assignmentContext: "",
        quickReplies: blankSlateReplies,
      }),
    );
  };

  const studySelected = () => {
    if (!selectedNode) return;
    setMobilePane("chat");
    const readiness =
      selectedNode.status === "locked"
        ? `I want to learn ${selectedNode.label}. Check which prerequisite I should tackle first.`
        : `I want to work on ${selectedNode.label}. Start by checking what I already understand.`;
    void sendMessage(readiness);
  };

  const retryLast = () => {
    if (pending || messages.at(-1)?.role !== "user") return;
    void requestTutor(messages);
  };

  const selectConcept = useCallback((id: string) => {
    setSelectedSystem(null);
    setSelectedId(id);
  }, []);

  const selectSystem = useCallback((key: string) => {
    setSelectedSystem(key);
  }, []);

  const handleCosmosSelect = useCallback(
    (pick: CosmosPick) => {
      if (pick.kind === "system") {
        selectSystem(pick.key);
      } else {
        selectConcept(pick.id);
      }
    },
    [selectConcept, selectSystem],
  );

  const selectProvider = (id: ProviderId) => {
    const preset = PROVIDERS.find((item) => item.id === id);
    if (!preset) return;
    setProvider((current) => ({
      ...current,
      id,
      model: preset.model,
      baseUrl: id === "custom" ? current.baseUrl : "",
    }));
  };

  const saveProvider = () => {
    if (!provider.apiKey.trim() || !provider.model.trim()) return;
    if (provider.id === "custom" && !provider.baseUrl?.trim()) return;
    setProvider((current) => ({
      ...current,
      apiKey: current.apiKey.trim(),
      model: current.model.trim(),
      baseUrl: current.baseUrl?.trim(),
    }));
    setSettingsOpen(false);
    setError("");
  };

  const forgetProvider = () => {
    localStorage.removeItem(PROVIDER_STORAGE_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    setProvider(DEFAULT_PROVIDER);
    setSettingsOpen(true);
  };

  const dossierToggle = (
    <button
      className="icon-button dossier__toggle"
      type="button"
      aria-expanded={dossierOpen}
      aria-controls="dossier-details"
      aria-label={dossierOpen ? "Hide details" : "Show details"}
      onClick={() => setDossierOpen((open) => !open)}
    >
      <Icon name="chevron-down" size={16} />
    </button>
  );

  const focusEvidence = sessionIsFresh ? 0 : (focusNode?.mastery ?? 0);
  const focusTitle = sessionIsFresh
    ? "Waiting for your topic"
    : (focusNode?.label ?? "Waiting for your topic");
  const systemPlanets = viewedSystem
    ? [...viewedSystem.planets].sort((a, b) => a.tier - b.tier)
    : [];
  const systemMoonCount = systemPlanets.reduce(
    (total, planet) => total + planet.moons.length,
    0,
  );

  return (
    <main className="app-shell" style={STATUS_TOKENS}>
      <header className="masthead">
        <div className="brand">
          <AsterMark size={22} />
          <span>Aster</span>
        </div>
        <button
          className="model-chip"
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label={`Model and API settings: ${providerName(provider.id)}, ${
            provider.model || "no model connected"
          }`}
        >
          <i className={provider.apiKey ? "is-connected" : ""} />
          <span>
            <b>{providerName(provider.id)}</b> {provider.model || "Connect a model"}
          </span>
          <Icon name="chevron-down" size={14} />
        </button>
        <button
          className="button button--primary masthead__new"
          type="button"
          onClick={startNewSession}
          aria-label="Start a new session and keep the learning universe"
        >
          <Icon name="plus" size={16} />
          <span>New session</span>
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={() => setResetOpen(true)}
          aria-label="Clear sky: reset learning and clear the universe"
          title="Clear sky"
        >
          <Icon name="rotate" size={17} />
        </button>
      </header>

      <nav className="pane-switch" aria-label="Study view">
        <button
          type="button"
          aria-pressed={mobilePane === "chat"}
          onClick={() => setMobilePane("chat")}
        >
          <Icon name="message" size={16} />
          Conversation
        </button>
        <button
          type="button"
          aria-pressed={mobilePane === "universe"}
          onClick={() => setMobilePane("universe")}
        >
          <Icon name="galaxy" size={16} />
          Universe
        </button>
      </nav>

      <section
        className={`log-panel ${mobilePane === "chat" ? "is-mobile-active" : ""}`}
        aria-label="Study conversation"
      >
        <div className="focus-head">
          <div className="focus-head__text">
            <p className="eyebrow eyebrow--signal">
              {sessionIsFresh ? "New session" : "In focus"}
            </p>
            <h1>{focusTitle}</h1>
            {!sessionIsFresh && focusNode && (
              <p className="focus-head__place">{describePlace(focusNode.id)}</p>
            )}
          </div>
          <EvidenceGauge
            value={focusEvidence}
            label={`Understanding evidence for ${
              sessionIsFresh ? "new topic" : (focusNode?.label ?? "new topic")
            }`}
          />
        </div>

        <div className="thread" ref={threadRef}>
          <p className="thread-date">Today · {DEPTH_LABELS[depth]} depth</p>

          {messages.map((message) => (
            <Fragment key={message.id}>
              <article className={`message message--${message.role}`}>
                <header className="message__meta">
                  {message.role === "assistant" && (
                    <Icon name="star" size={12} className="message__mark" />
                  )}
                  <strong>{message.role === "assistant" ? "Aster" : "You"}</strong>
                  {message.timestamp && <time>{message.timestamp}</time>}
                </header>
                <div className="message__content">
                  {message.role === "assistant" ? (
                    <ReactMarkdown
                      components={{
                        a: ({ href, children }) => (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                          >
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  ) : (
                    message.content
                  )}
                </div>
              </article>

              {message.milestone && (
                <aside className="insight">
                  <p className="eyebrow eyebrow--signal">
                    <Icon name="star" size={11} />
                    Insight logged, in your words
                  </p>
                  <blockquote>{message.milestone.title}</blockquote>
                  <p>{message.milestone.summary}</p>
                  <small>Saved with this learning trail</small>
                </aside>
              )}
            </Fragment>
          ))}

          {pending && (
            <article className="message message--assistant">
              <header className="message__meta">
                <Icon name="star" size={12} className="message__mark" />
                <strong>Aster</strong>
                <time>thinking with you</time>
              </header>
              <div className="thinking" role="status" aria-label="Aster is thinking">
                <span className="orbit-spinner" aria-hidden="true">
                  <i />
                </span>
              </div>
            </article>
          )}

          {!pending && quickReplies.length > 0 && (
            <div className="starters" aria-label="Response starters">
              {quickReplies.map((reply) =>
                isSentenceStarter(reply) ? (
                  <button
                    type="button"
                    key={reply}
                    className="is-starter"
                    title="Finish this in the message box"
                    onClick={() => startReply(reply)}
                  >
                    {reply}
                  </button>
                ) : (
                  <button
                    type="button"
                    key={reply}
                    onClick={() => void sendMessage(reply)}
                  >
                    {reply}
                  </button>
                ),
              )}
            </div>
          )}
        </div>

        <div className="composer-dock">
          {error && (
            <div className="composer-error" role="alert">
              <span>{error}</span>
              {messages.at(-1)?.role === "user" && (
                <button type="button" onClick={retryLast}>
                  Retry
                </button>
              )}
            </div>
          )}

          {assignmentContext && (
            <button className="context-chip" type="button" onClick={openContext}>
              <Icon name="check" size={13} />
              Assignment context attached
            </button>
          )}

          <form className="composer" onSubmit={handleSubmit}>
            <textarea
              ref={textAreaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Think out loud. Rough reasoning is welcome…"
              rows={2}
              aria-label="Message Aster"
              disabled={pending}
            />
            <div className="composer-bar">
              <button
                type="button"
                className="icon-button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach text notes or a rubric"
                title="Attach notes or a rubric"
              >
                <Icon name="paperclip" size={17} />
              </button>
              <button
                type="button"
                className={`icon-button ${assignmentContext ? "is-on" : ""}`}
                onClick={openContext}
                aria-label={
                  assignmentContext
                    ? "Edit assignment context"
                    : "Add assignment context"
                }
                title={assignmentContext ? "Edit assignment" : "Add assignment"}
              >
                <Icon name="book-open" size={17} />
              </button>
              <fieldset className="depth-dial">
                <legend className="visually-hidden">Target depth</legend>
                <span className="depth-dial__label" aria-hidden="true">
                  Depth
                </span>
                <span className="depth-dial__stops">
                  {([1, 2, 3, 4, 5] as DepthLevel[]).map((level) => (
                    <label
                      className="depth-dial__stop"
                      key={level}
                      title={`${level} · ${DEPTH_LABELS[level]}`}
                    >
                      <input
                        type="radio"
                        name="depth"
                        value={level}
                        checked={depth === level}
                        onChange={() => setDepth(level)}
                        aria-label={`${level}, ${DEPTH_LABELS[level]}`}
                      />
                      <span aria-hidden="true">{level}</span>
                    </label>
                  ))}
                </span>
                <span className="depth-dial__name" aria-hidden="true">
                  {DEPTH_LABELS[depth]}
                </span>
              </fieldset>
              <button
                className="send-button"
                type="submit"
                disabled={!input.trim() || pending}
                aria-label="Send message"
              >
                <Icon name="arrow-up" size={18} />
              </button>
            </div>
          </form>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".txt,.md,.csv,.json,.html,.js,.ts,.tsx,.py"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <p className="composer-note">
            <span className="composer-note__keys">
              Enter to send · Shift + Enter for a new line
            </span>
            <span>Aster guides the thinking; you keep authorship of the answer.</span>
          </p>
        </div>
      </section>

      <section
        className={`universe-panel ${
          mobilePane === "universe" ? "is-mobile-active" : ""
        }`}
        aria-label="Learning universe"
      >
        <SkillUniverse
          nodes={nodes}
          edges={edges}
          cosmos={cosmos}
          selection={selection}
          onSelect={handleCosmosSelect}
        />

        <div className="universe-hud" data-occludes>
          <p className="eyebrow">Learning universe</p>
          {selection?.kind === "body" && viewedSystem && (
            <nav className="cosmos-path" aria-label="Location in the universe">
              <button type="button" onClick={() => selectSystem(viewedSystem.key)}>
                {viewedSystem.label}
              </button>
              {hostNode && (
                <>
                  <span aria-hidden="true">/</span>
                  <button type="button" onClick={() => selectConcept(hostNode.id)}>
                    {hostNode.label}
                  </button>
                </>
              )}
            </nav>
          )}
          <h2>
            {selection?.kind === "system"
              ? viewedSystem?.label
              : (selectedNode?.label ?? "Uncharted sky")}
          </h2>
          <p className="universe-stats">
            <b>{masteredCount}</b> mastered · <b>{nodes.length}</b> mapped ·{" "}
            <b>{cosmos.systems.length}</b>{" "}
            {cosmos.systems.length === 1 ? "system" : "systems"}
          </p>
        </div>

        {nodes.length ? (
          <div className="universe-key" role="group" aria-label="Map key" data-occludes>
            <ul className="universe-key__bodies">
              <li>
                <Icon name="star" size={13} />
                Subject
              </li>
              <li>
                <Icon name="planet" size={15} />
                Concept
              </li>
              <li>
                <Icon name="moon" size={13} />
                Sub-concept
              </li>
            </ul>
            <ul className="universe-key__status">
              {STATUS_ORDER.map((status) => (
                <li key={status} data-status={status}>
                  <i aria-hidden="true" />
                  {statusLabel(status)}
                </li>
              ))}
            </ul>
            <p className="universe-key__hint">
              Drag to orbit · scroll or pinch to zoom · select any body
            </p>
          </div>
        ) : (
          <div className="universe-empty">
            <Icon name="star" size={18} />
            <strong>Your universe begins with a question</strong>
            <p>
              Start a conversation and Aster will chart the concepts hiding
              inside it.
            </p>
          </div>
        )}

        {selection?.kind === "system" && viewedSystem ? (
          <aside
            className={`dossier ${dossierOpen ? "" : "is-collapsed"}`}
            aria-live="polite"
            aria-label="Selected star system"
            data-occludes
          >
            <div className="dossier__top">
              <span className="status-tag status-tag--system">
                <Icon name="star" size={12} />
                Star system
              </span>
              <span className="dossier__evidence">
                <b>{viewedSystem.mastered}</b> of {viewedSystem.total} mastered
              </span>
              {dossierToggle}
            </div>
            <h3>{viewedSystem.label}</h3>
            <div className="dossier__details" id="dossier-details" hidden={!dossierOpen}>
              <p className="dossier__place">
                {systemPlanets.length}{" "}
                {systemPlanets.length === 1 ? "planet" : "planets"} ·{" "}
                {systemMoonCount} {systemMoonCount === 1 ? "moon" : "moons"}
              </p>
              <div className="evidence-rule" aria-hidden="true">
                <span
                  style={{
                    width: `${
                      viewedSystem.total
                        ? (viewedSystem.mastered / viewedSystem.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
              <dl className="dossier__facts">
                <div>
                  <dt>Planets</dt>
                  <dd>
                    {systemPlanets
                      .map((planet) => nodeById.get(planet.id))
                      .filter(isNode)
                      .map((node) => (
                        <BodyChip key={node.id} node={node} onSelect={selectConcept} />
                      ))}
                  </dd>
                </div>
              </dl>
            </div>
          </aside>
        ) : (
          selectedNode && (
            <aside
              className={`dossier ${dossierOpen ? "" : "is-collapsed"}`}
              aria-live="polite"
              aria-label="Selected concept"
              data-occludes
            >
              <div className="dossier__top">
                <span className="status-tag" data-status={selectedNode.status}>
                  <i aria-hidden="true" />
                  {statusLabel(selectedNode.status)}
                </span>
                <span className="dossier__evidence">
                  <b>{selectedNode.mastery}%</b> evidence
                </span>
                {dossierToggle}
              </div>
              <h3>{selectedNode.label}</h3>
              <div className="dossier__details" id="dossier-details" hidden={!dossierOpen}>
                <p className="dossier__place">{describePlace(selectedNode.id)}</p>
                <p className="dossier__description">{selectedNode.description}</p>
                <div className="evidence-rule" aria-hidden="true">
                  <span style={{ width: `${selectedNode.mastery}%` }} />
                </div>
                {selectedNode.evidence && (
                  <p className="dossier__note">
                    <span>Latest evidence</span>
                    {selectedNode.evidence}
                  </p>
                )}
                <dl className="dossier__facts">
                  {hostNode && (
                    <div>
                      <dt>Orbits</dt>
                      <dd>
                        <BodyChip node={hostNode} onSelect={selectConcept} />
                      </dd>
                    </div>
                  )}
                  {moonNodes.length > 0 && (
                    <div>
                      <dt>Moons</dt>
                      <dd>
                        {moonNodes.map((node) => (
                          <BodyChip key={node.id} node={node} onSelect={selectConcept} />
                        ))}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Connected from</dt>
                    <dd>
                      {connections.length ? (
                        connections.map((node) => (
                          <BodyChip key={node.id} node={node} onSelect={selectConcept} />
                        ))
                      ) : (
                        <span className="dossier__none">Foundational concept</span>
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="dossier__actions">
                  {selectedNode.id === focusNode?.id && !sessionIsFresh ? (
                    <span className="dossier__current">
                      <Icon name="message" size={15} />
                      In conversation
                    </span>
                  ) : (
                    <button
                      className="button button--primary"
                      type="button"
                      onClick={studySelected}
                      disabled={pending}
                    >
                      <Icon
                        name={selectedNode.status === "locked" ? "compass" : "sparkles"}
                        size={15}
                      />
                      {selectedNode.status === "locked"
                        ? "Check readiness"
                        : "Study this concept"}
                    </button>
                  )}
                </div>
              </div>
            </aside>
          )
        )}
      </section>

      {settingsOpen && hydrated && (
        <div
          className="sheet-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && provider.apiKey) {
              setSettingsOpen(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && provider.apiKey) setSettingsOpen(false);
          }}
        >
          <section
            className="sheet sheet--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connection-title"
          >
            <header className="sheet__head">
              <div>
                <p className="eyebrow eyebrow--signal">
                  {provider.apiKey ? "Model connection" : "One-time setup"}
                </p>
                <h2 id="connection-title">Bring your own AI model</h2>
                <p className="sheet__intro">
                  Your key passes through Aster to your chosen provider only
                  when you send a message. It is never stored on Aster’s server.
                </p>
              </div>
              {provider.apiKey && (
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Close model settings"
                >
                  <Icon name="x" size={18} />
                </button>
              )}
            </header>

            <div className="segmented" role="group" aria-label="AI provider">
              {PROVIDERS.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  aria-pressed={provider.id === item.id}
                  onClick={() => selectProvider(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>

            <div className="field-grid">
              <label className="field">
                <span>Model</span>
                <input
                  value={provider.model}
                  onChange={(event) =>
                    setProvider((current) => ({
                      ...current,
                      model: event.target.value,
                    }))
                  }
                  placeholder="Model ID"
                />
              </label>
              {provider.id === "custom" && (
                <label className="field">
                  <span>OpenAI-compatible base URL</span>
                  <input
                    value={provider.baseUrl ?? ""}
                    onChange={(event) =>
                      setProvider((current) => ({
                        ...current,
                        baseUrl: event.target.value,
                      }))
                    }
                    placeholder="https://api.example.com/v1"
                  />
                </label>
              )}
              <label className="field">
                <span>API key</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={provider.apiKey}
                  onChange={(event) =>
                    setProvider((current) => ({
                      ...current,
                      apiKey: event.target.value,
                    }))
                  }
                  placeholder={
                    PROVIDERS.find((item) => item.id === provider.id)
                      ?.keyPlaceholder
                  }
                  autoFocus={!provider.apiKey}
                />
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={provider.remember}
                  onChange={(event) =>
                    setProvider((current) => ({
                      ...current,
                      remember: event.target.checked,
                    }))
                  }
                />
                <span>
                  Remember on this device
                  <small>
                    Turn this off on a shared computer. The key will disappear
                    when this tab closes.
                  </small>
                </span>
              </label>
            </div>

            <section className="price-sheet" aria-labelledby="pricing-title">
              <div className="price-sheet__head">
                <h3 id="pricing-title">Flagship list prices per 1M tokens</h3>
                <p>Checked July 26, 2026 · billed by your provider</p>
              </div>
              <div className="price-table-wrap">
                <table className="price-table">
                  <thead>
                    <tr>
                      <th scope="col">Provider</th>
                      <th scope="col" className="num">
                        Input
                      </th>
                      <th scope="col" className="num">
                        Output
                      </th>
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {PROVIDERS.filter((item) => item.id !== "custom").map(
                      (item) => (
                        <tr
                          key={item.id}
                          className={provider.id === item.id ? "is-selected" : ""}
                        >
                          <th scope="row">
                            <strong>{item.name}</strong>
                            <small>{item.detail}</small>
                          </th>
                          <td className="num">{item.inputPrice}</td>
                          <td className="num">{item.outputPrice}</td>
                          <td className="price-table__actions">
                            <button
                              type="button"
                              onClick={() => selectProvider(item.id)}
                              disabled={provider.id === item.id}
                            >
                              {provider.id === item.id ? "Selected" : "Use model"}
                            </button>
                            <a
                              href={item.pricingUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Official pricing
                              <span className="visually-hidden">
                                {" "}
                                for {item.name}, opens in a new tab
                              </span>
                            </a>
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <footer className="sheet__foot">
              <div>
                {provider.apiKey && (
                  <button
                    className="text-button text-button--danger"
                    type="button"
                    onClick={forgetProvider}
                  >
                    Forget connection
                  </button>
                )}
              </div>
              <button
                className="button button--primary"
                type="button"
                onClick={saveProvider}
                disabled={
                  !provider.apiKey.trim() ||
                  !provider.model.trim() ||
                  (provider.id === "custom" && !provider.baseUrl?.trim())
                }
              >
                <Icon name="check" size={16} />
                Save &amp; start studying
              </button>
            </footer>
          </section>
        </div>
      )}

      {resetOpen && (
        <div
          className="sheet-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setResetOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setResetOpen(false);
          }}
        >
          <section
            className="sheet sheet--narrow"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
          >
            <p className="eyebrow eyebrow--danger">Clear sky</p>
            <h2 id="reset-title">Start with a blank slate?</h2>
            <p className="sheet__intro">
              This clears the conversation, assignment, and every concept in
              your learning universe. Your model connection stays ready.
            </p>
            <div className="sheet__actions">
              <button
                className="button button--ghost"
                type="button"
                onClick={() => setResetOpen(false)}
                autoFocus
              >
                Keep learning
              </button>
              <button
                className="button button--danger"
                type="button"
                onClick={resetLearning}
              >
                Reset everything
              </button>
            </div>
          </section>
        </div>
      )}

      {contextOpen && (
        <div
          className="sheet-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setContextOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setContextOpen(false);
          }}
        >
          <section
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="context-title"
          >
            <header className="sheet__head">
              <div>
                <p className="eyebrow eyebrow--signal">Optional session context</p>
                <h2 id="context-title">Add the assignment or rubric</h2>
                <p className="sheet__intro">
                  Paste the relevant prompt, grading criteria, or notes. Aster
                  uses them to stay aligned without forcing an upload.
                </p>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setContextOpen(false)}
                aria-label="Close"
              >
                <Icon name="x" size={18} />
              </button>
            </header>
            <textarea
              className="context-input"
              value={contextDraft}
              onChange={(event) => setContextDraft(event.target.value)}
              placeholder="Paste assignment context here…"
              aria-label="Assignment context"
              rows={12}
              autoFocus
            />
            <footer className="sheet__foot">
              <span className="sheet__count">
                {contextDraft.length.toLocaleString()} characters
              </span>
              <div className="sheet__actions">
                {assignmentContext && (
                  <button
                    className="text-button text-button--danger"
                    type="button"
                    onClick={() => {
                      setContextDraft("");
                      setAssignmentContext("");
                    }}
                  >
                    Clear
                  </button>
                )}
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => setContextOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={saveContext}
                >
                  Save context
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
