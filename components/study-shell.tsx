"use client";

import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import {
  FormEvent,
  Fragment,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DOMAIN_COLORS,
  STARTER_EDGES,
  STARTER_NODES,
  positionForConcept,
} from "@/lib/concepts";
import { PROVIDERS, providerName } from "@/lib/providers";
import { DEPTH_LABELS } from "@/lib/system-prompt";
import type {
  ChatMessage,
  ConceptEdge,
  ConceptNode,
  DepthLevel,
  ProviderConfig,
  ProviderId,
  TutorResponse,
} from "@/lib/types";
import { Icon } from "@/components/icons";

const SkillUniverse = dynamic(
  () => import("@/components/skill-universe").then((module) => module.SkillUniverse),
  {
    ssr: false,
    loading: () => (
      <div className="universe-loading" aria-label="Loading concept universe">
        <span />
        <span />
        <span />
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
      "Yes—the factorization is right, and it exposes why substitution looked broken. For every x near 2 except x = 2, the shared (x − 2) can be removed. After that cancellation, what value does the remaining expression approach?",
    timestamp: "10:43",
  },
];

const STARTER_QUICK_REPLIES = [
  "It becomes x + 2, so it approaches 4.",
  "Why are we allowed to cancel it?",
  "I’m still stuck on 0/0.",
];

const FRESH_SESSION_REPLIES = [
  "I have a homework problem.",
  "Teach me a concept from scratch.",
  "Help me prepare for an exam.",
];

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

function statusLabel(status: ConceptNode["status"]) {
  if (status === "learning") return "In focus";
  if (status === "mastered") return "Mastered";
  if (status === "suggested") return "Within reach";
  return "Further out";
}

export function StudyShell() {
  const [messages, setMessages] = useState<ChatMessage[]>(STARTER_MESSAGES);
  const [nodes, setNodes] = useState<ConceptNode[]>(STARTER_NODES);
  const [edges, setEdges] = useState<ConceptEdge[]>(STARTER_EDGES);
  const [selectedId, setSelectedId] = useState("factoring");
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

  const prerequisites = useMemo(
    () =>
      selectedNode
        ? edges
        .filter((edge) => edge.to === selectedNode.id)
        .map((edge) => nodes.find((node) => node.id === edge.from))
        .filter((node): node is ConceptNode => Boolean(node))
            .slice(0, 3)
        : [],
    [edges, nodes, selectedNode],
  );

  const graphSummary = useMemo(
    () =>
      nodes
        .filter((node) => node.status !== "locked")
        .map(
          (node) =>
            `${node.label} (${node.status}, ${node.mastery}% evidence)`,
        )
        .join("; "),
    [nodes],
  );

  const mergeTutorState = useCallback((response: TutorResponse) => {
    const focus = response.focus;
    const milestone = response.milestone;

    setNodes((previous) => {
      let next = previous.map((node) => {
        if (node.id === focus.id) {
          return {
            ...node,
            label: focus.label,
            domain: focus.domain,
            description: focus.description,
            status: "learning" as const,
            mastery: focus.mastery,
          };
        }
        if (node.status === "learning") {
          return {
            ...node,
            status:
              node.mastery >= 75
                ? ("mastered" as const)
                : ("suggested" as const),
          };
        }
        return node;
      });

      if (!next.some((node) => node.id === focus.id)) {
        next = [
          ...next,
          {
            id: focus.id,
            label: focus.label,
            domain: focus.domain,
            description: focus.description,
            status: "learning",
            mastery: focus.mastery,
            position: positionForConcept(focus.id, focus.domain),
          },
        ];
      }

      response.related.forEach((related) => {
        const existingIndex = next.findIndex((node) => node.id === related.id);
        if (existingIndex >= 0) {
          const existing = next[existingIndex];
          if (
            existing.status !== "mastered" &&
            existing.status !== "learning"
          ) {
            next[existingIndex] = {
              ...existing,
              label: related.label,
              domain: related.domain,
              description: related.description,
              status: related.status,
            };
          }
        } else {
          next.push({
            id: related.id,
            label: related.label,
            domain: related.domain,
            description: related.description,
            status: related.status,
            mastery: 0,
            position: positionForConcept(related.id, related.domain),
          });
        }
      });

      if (response.milestone?.masteredConcepts.length) {
        next = next.map((node) =>
          response.milestone?.masteredConcepts.includes(node.id)
            ? {
                ...node,
                status: "mastered" as const,
                mastery: Math.max(node.mastery, 80),
              }
            : node,
        );
      }

      if (milestone) {
        next = next.map((node) =>
          node.id === focus.id
            ? {
                ...node,
                insights: [
                  ...(node.insights ?? []).filter(
                    (insight) =>
                      insight.title !== milestone.title ||
                      insight.summary !== milestone.summary,
                  ),
                  milestone,
                ].slice(-8),
              }
            : node,
        );
      }

      return [...next];
    });

    setEdges((previous) => {
      const next = [...previous];
      response.related.forEach((related) => {
        const from =
          related.relation === "prerequisite" ? related.id : focus.id;
        const to =
          related.relation === "prerequisite" ? focus.id : related.id;
        if (!next.some((edge) => edge.from === from && edge.to === to)) {
          next.push({ from, to, relation: related.relation });
        }
      });
      return next;
    });

    setSelectedId(focus.id);
    setQuickReplies(response.quickReplies);
  }, []);

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
            currentConcept: sessionIsFresh ? "" : (focusNode?.label ?? ""),
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
      focusNode?.label,
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
        "New trail, same universe. What are we exploring next? Start anywhere—if it connects to something you already know, we’ll let that bridge reveal itself naturally.",
      timestamp: timeLabel(),
    };
    const preservedNodes = nodes.map((node) =>
      node.status === "learning"
        ? {
            ...node,
            status:
              node.mastery >= 75
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
        "Blank slate, open sky. What are we untangling today? Drop in the topic, problem, or your messiest first thought—I’ll help you find the next step without taking the thinking away from you.",
      timestamp: timeLabel(),
    };
    setMessages([welcome]);
    setNodes([]);
    setEdges([]);
    setSelectedId("");
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
    setSelectedId(id);
  }, []);

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

  return (
    <main className="app-shell">
      <aside className="app-rail" aria-label="Primary navigation">
        <button
          className="brand-mark"
          type="button"
          aria-label="Aster home"
          onClick={() => setMobilePane("chat")}
        >
          <Icon name="sparkles" size={21} />
        </button>

        <nav className="rail-nav">
          <button
            type="button"
            className={`rail-button ${mobilePane === "chat" ? "is-active" : ""}`}
            onClick={() => setMobilePane("chat")}
            aria-label="Study conversation"
          >
            <Icon name="message" />
            <span className="rail-tooltip">Conversation</span>
          </button>
          <button
            type="button"
            className={`rail-button ${
              mobilePane === "universe" ? "is-active" : ""
            }`}
            onClick={() => setMobilePane("universe")}
            aria-label="Learning universe"
          >
            <Icon name="galaxy" />
            <span className="rail-tooltip">Learning universe</span>
          </button>
          <button
            type="button"
            className="rail-button"
            onClick={openContext}
            aria-label="Assignment context"
          >
            <Icon name="book-open" />
            <span className="rail-tooltip">Assignment context</span>
          </button>
        </nav>

        <div className="rail-bottom">
          <button
            className="rail-button rail-new"
            type="button"
            onClick={startNewSession}
            aria-label="Start a new session"
          >
            <Icon name="plus" />
            <span className="rail-tooltip">New session · keep your universe</span>
          </button>
          <button
            className="rail-button"
            type="button"
            onClick={() => setResetOpen(true)}
            aria-label="Reset learning"
          >
            <Icon name="rotate" />
            <span className="rail-tooltip">Reset learning</span>
          </button>
          <div className="profile-orb" aria-label="Local learner profile">
            <Icon name="brain" size={15} />
            <i />
          </div>
        </div>
      </aside>

      <section className="app-main">
        <header className="topbar">
          <div className="topbar-brand">
            <span className="mobile-brand-mark">
              <Icon name="sparkles" size={17} />
            </span>
            <div>
              <p>Current learning trail</p>
              <h1>
                {sessionIsFresh ? "New session" : (focusNode?.label ?? "New session")}
              </h1>
            </div>
          </div>

          <div className="topbar-actions">
            <button
              className="model-button"
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Model and API settings"
            >
              <i className={provider.apiKey ? "is-connected" : ""} />
              <span>
                <small>{providerName(provider.id)}</small>
                {provider.model || "Connect model"}
              </span>
              <Icon name="chevron-down" size={14} />
            </button>
            <button
              className="context-button"
              type="button"
              onClick={openContext}
              aria-label={
                assignmentContext
                  ? "Edit assignment context"
                  : "Add assignment context"
              }
            >
              <Icon name={assignmentContext ? "check" : "file-plus"} size={16} />
              <span>
                {assignmentContext ? "Context added" : "Add assignment"}
              </span>
            </button>
            <label className="depth-control" data-level={depth}>
              <span>Depth</span>
              <select
                value={depth}
                onChange={(event) =>
                  setDepth(Number(event.target.value) as DepthLevel)
                }
                aria-label="Target depth"
              >
                {([1, 2, 3, 4, 5] as DepthLevel[]).map((level) => (
                  <option value={level} key={level}>
                    {level} · {DEPTH_LABELS[level]}
                  </option>
                ))}
              </select>
              <Icon name="chevron-down" size={14} />
            </label>
            <button
              className="new-session-button"
              type="button"
              onClick={startNewSession}
              aria-label="Start a new session and keep the learning universe"
            >
              <Icon name="plus" size={16} />
              <span>New session</span>
            </button>
            <button
              className="reset-button"
              type="button"
              onClick={() => setResetOpen(true)}
              aria-label="Reset learning and clear the universe"
            >
              <Icon name="rotate" size={16} />
              <span>Clear sky</span>
            </button>
          </div>
        </header>

        <div className="mobile-switcher" aria-label="Study view">
          <button
            type="button"
            className={mobilePane === "chat" ? "is-active" : ""}
            onClick={() => setMobilePane("chat")}
          >
            <Icon name="message" size={16} />
            Study
          </button>
          <button
            type="button"
            className={mobilePane === "universe" ? "is-active" : ""}
            onClick={() => setMobilePane("universe")}
          >
            <Icon name="galaxy" size={16} />
            Universe
          </button>
        </div>

        <div className="workspace">
          <section
            className={`conversation-panel ${
              mobilePane === "chat" ? "is-mobile-active" : ""
            }`}
            aria-label="Study conversation"
          >
            <div className="conversation-meta">
              <div>
                <span className="eyebrow">Working concept</span>
                <h2>
                  {sessionIsFresh
                    ? "Waiting for your topic"
                    : (focusNode?.label ?? "Waiting for your topic")}
                </h2>
              </div>
              <div className="understanding-readout">
                <span>{sessionIsFresh ? 0 : (focusNode?.mastery ?? 0)}%</span>
                <small>evidence</small>
              </div>
            </div>
            <div
              className="learning-progress"
              role="progressbar"
              aria-label={`Understanding evidence for ${
                sessionIsFresh ? "new topic" : (focusNode?.label ?? "new topic")
              }`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={sessionIsFresh ? 0 : (focusNode?.mastery ?? 0)}
            >
              <span
                style={{
                  width: `${sessionIsFresh ? 0 : (focusNode?.mastery ?? 0)}%`,
                }}
              />
            </div>

            <div className="message-thread" ref={threadRef}>
              <div className="thread-date">
                <span />
                <p>Today · Structural depth</p>
                <span />
              </div>

              {messages.map((message) => (
                <Fragment key={message.id}>
                  <article
                    className={`message message--${message.role}`}
                  >
                    {message.role === "assistant" && (
                      <div className="assistant-avatar" aria-hidden="true">
                        <Icon name="sparkles" size={15} />
                      </div>
                    )}
                    <div className="message-body">
                      <div className="message-author">
                        <span>
                          {message.role === "assistant" ? "Aster" : "You"}
                        </span>
                        {message.timestamp && <time>{message.timestamp}</time>}
                      </div>
                      <div className="message-content">
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
                    </div>
                  </article>

                  {message.milestone && (
                    <aside className="milestone-card">
                      <div className="milestone-icon">
                        <Icon name="sparkles" size={18} />
                      </div>
                      <div>
                        <span>Insight captured in your words</span>
                        <blockquote>{message.milestone.title}</blockquote>
                        <p>{message.milestone.summary}</p>
                        <small>Saved with this learning trail</small>
                      </div>
                    </aside>
                  )}
                </Fragment>
              ))}

              {pending && (
                <article className="message message--assistant">
                  <div className="assistant-avatar" aria-hidden="true">
                    <Icon name="sparkles" size={15} />
                  </div>
                  <div className="message-body">
                    <div className="message-author">
                      <span>Aster</span>
                      <time>thinking with you</time>
                    </div>
                    <div className="thinking-indicator" aria-label="Aster is thinking">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </article>
              )}

              {!pending && quickReplies.length > 0 && (
                <div className="quick-replies" aria-label="Response starters">
                  {quickReplies.map((reply) => (
                    <button
                      type="button"
                      key={reply}
                      onClick={() => void sendMessage(reply)}
                    >
                      {reply}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="composer-wrap">
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
                <button
                  className="context-chip"
                  type="button"
                  onClick={openContext}
                >
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
                  placeholder="Think out loud—rough reasoning is welcome…"
                  rows={2}
                  aria-label="Message Aster"
                  disabled={pending}
                />
                <div className="composer-toolbar">
                  <div className="composer-tools">
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => fileInputRef.current?.click()}
                      aria-label="Attach text notes or a rubric"
                    >
                      <Icon name="paperclip" size={17} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={openContext}
                      aria-label="Paste assignment context"
                    >
                      <Icon name="book-open" size={17} />
                    </button>
                    <span>Enter to send · Shift + Enter for a new line</span>
                  </div>
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
              <p className="privacy-note">
                Aster guides the thinking; you keep authorship of the answer.
              </p>
            </div>
          </section>

          <section
            className={`universe-panel ${
              mobilePane === "universe" ? "is-mobile-active" : ""
            }`}
            aria-label="Learning universe"
          >
            <div className="universe-gradient" />
            <div className="universe-header">
              <div>
                <span className="eyebrow">Learning universe</span>
                <h2>
                  {focusNode?.domain ?? "Knowledge"}{" "}
                  <span>
                    / {focusNode?.label ?? "Awaiting first concept"}
                  </span>
                </h2>
              </div>
              <div className="universe-stats">
                <div>
                  <strong>{masteredCount}</strong>
                  <span>mastered</span>
                </div>
                <i />
                <div>
                  <strong>{nodes.length}</strong>
                  <span>mapped</span>
                </div>
              </div>
            </div>

            <div className="universe-legend" aria-label="Concept status legend">
              <span className="legend-learning">
                <i /> In focus
              </span>
              <span className="legend-mastered">
                <i /> Mastered
              </span>
              <span className="legend-suggested">
                <i /> Within reach
              </span>
              <span className="legend-locked">
                <i /> Further out
              </span>
            </div>

            <SkillUniverse
              nodes={nodes}
              edges={edges}
              selectedId={selectedId}
              onSelect={selectConcept}
            />

            {nodes.length ? (
              <div className="universe-hint">
                <Icon name="orbit" size={15} />
                Drag to orbit · scroll to travel · select a star
              </div>
            ) : (
              <div className="universe-empty">
                <span>
                  <Icon name="sparkles" size={19} />
                </span>
                <strong>Your universe begins with a question</strong>
                <p>
                  Start a conversation and Aster will map the concepts hiding
                  inside it.
                </p>
              </div>
            )}

            {selectedNode && (
              <aside className="concept-card" aria-live="polite">
              <div className="concept-card-top">
                <div>
                  <span
                    className={`concept-status concept-status--${selectedNode.status}`}
                  >
                    <i
                      style={{
                        background:
                          DOMAIN_COLORS[selectedNode.domain] ??
                          DOMAIN_COLORS.General,
                      }}
                    />
                    {statusLabel(selectedNode.status)}
                  </span>
                  <h3>{selectedNode.label}</h3>
                  <p>{selectedNode.description}</p>
                </div>
                <div className="concept-mastery">
                  <strong>{selectedNode.mastery}%</strong>
                  <span>evidence</span>
                </div>
              </div>

              <div className="concept-progress">
                <span style={{ width: `${selectedNode.mastery}%` }} />
              </div>

              <div className="concept-card-bottom">
                <div className="built-from">
                  <span>Connected from</span>
                  <div>
                    {prerequisites.length ? (
                      prerequisites.map((node) => (
                        <button
                          type="button"
                          key={node.id}
                          onClick={() => setSelectedId(node.id)}
                        >
                          {node.label}
                        </button>
                      ))
                    ) : (
                      <small>Foundational concept</small>
                    )}
                  </div>
                </div>
                {selectedNode.id === focusNode?.id ? (
                  <button className="focus-button is-current" type="button">
                    <Icon name="message" size={15} />
                    In conversation
                  </button>
                ) : (
                  <button
                    className="focus-button"
                    type="button"
                    onClick={studySelected}
                    disabled={pending}
                  >
                    <Icon
                      name={
                        selectedNode.status === "locked" ? "compass" : "sparkles"
                      }
                      size={15}
                    />
                    {selectedNode.status === "locked"
                      ? "Check readiness"
                      : "Study this concept"}
                  </button>
                )}
              </div>
              </aside>
            )}
          </section>
        </div>
      </section>

      {settingsOpen && hydrated && (
        <div
          className="context-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && provider.apiKey) {
              setSettingsOpen(false);
            }
          }}
        >
          <section
            className="connection-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connection-title"
          >
            <div className="connection-heading">
              <div className="connection-heading-icon">
                <Icon name="orbit" size={20} />
              </div>
              <div>
                <span>{provider.apiKey ? "Model connection" : "One-time setup"}</span>
                <h2 id="connection-title">Bring your own AI model</h2>
                <p>
                  Your key passes through Aster to your chosen provider only
                  when you send a message. It is never stored on Aster’s server.
                </p>
              </div>
              {provider.apiKey && (
                <button
                  className="sheet-close"
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Close model settings"
                >
                  <Icon name="x" size={18} />
                </button>
              )}
            </div>

            <div className="provider-tabs" aria-label="AI provider">
              {PROVIDERS.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={provider.id === item.id ? "is-active" : ""}
                  onClick={() => selectProvider(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>

            <div className="connection-fields">
              <label>
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
                <label>
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
              <label>
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
              <label className="remember-key">
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

            <div className="pricing-widget">
              <div className="pricing-heading">
                <div>
                  <span>Flagship model snapshot</span>
                  <h3>List price per 1M tokens</h3>
                </div>
                <small>Checked July 26, 2026 · billed by provider</small>
              </div>
              <div className="pricing-grid">
                {PROVIDERS.filter((item) => item.id !== "custom").map(
                  (item) => (
                    <article
                      key={item.id}
                      className={provider.id === item.id ? "is-selected" : ""}
                    >
                      <div>
                        <strong>{item.name}</strong>
                        <small>{item.detail}</small>
                      </div>
                      <dl>
                        <div>
                          <dt>Input</dt>
                          <dd>{item.inputPrice}</dd>
                        </div>
                        <div>
                          <dt>Output</dt>
                          <dd>{item.outputPrice}</dd>
                        </div>
                      </dl>
                      <div className="price-actions">
                        <button
                          type="button"
                          onClick={() => selectProvider(item.id)}
                        >
                          Use model
                        </button>
                        <a
                          href={item.pricingUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Official pricing
                        </a>
                      </div>
                    </article>
                  ),
                )}
              </div>
            </div>

            <div className="connection-footer">
              <div>
                {provider.apiKey && (
                  <button
                    className="forget-key"
                    type="button"
                    onClick={forgetProvider}
                  >
                    Forget connection
                  </button>
                )}
              </div>
              <button
                className="connect-button"
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
            </div>
          </section>
        </div>
      )}

      {resetOpen && (
        <div
          className="context-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setResetOpen(false);
          }}
        >
          <section
            className="reset-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
          >
            <span className="reset-icon">
              <Icon name="rotate" size={21} />
            </span>
            <h2 id="reset-title">Start with a blank slate?</h2>
            <p>
              This clears the conversation, assignment, and every concept in
              your learning universe. Your model connection stays ready.
            </p>
            <div>
              <button type="button" onClick={() => setResetOpen(false)}>
                Keep learning
              </button>
              <button type="button" onClick={resetLearning}>
                Reset everything
              </button>
            </div>
          </section>
        </div>
      )}

      {contextOpen && (
        <div
          className="context-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setContextOpen(false);
          }}
        >
          <section
            className="context-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="context-title"
          >
            <div className="context-sheet-header">
              <div className="context-sheet-icon">
                <Icon name="book-open" size={19} />
              </div>
              <div>
                <span>Optional session context</span>
                <h2 id="context-title">Add the assignment or rubric</h2>
              </div>
              <button
                type="button"
                onClick={() => setContextOpen(false)}
                aria-label="Close"
              >
                <Icon name="x" size={18} />
              </button>
            </div>
            <p className="context-intro">
              Paste the relevant prompt, grading criteria, or notes. Aster uses
              them to stay aligned without forcing an upload.
            </p>
            <textarea
              value={contextDraft}
              onChange={(event) => setContextDraft(event.target.value)}
              placeholder="Paste assignment context here…"
              rows={12}
              autoFocus
            />
            <div className="context-sheet-footer">
              <span>{contextDraft.length.toLocaleString()} characters</span>
              <div>
                {assignmentContext && (
                  <button
                    className="clear-context"
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
                  className="cancel-context"
                  type="button"
                  onClick={() => setContextOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="save-context"
                  type="button"
                  onClick={saveContext}
                >
                  Save context
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
