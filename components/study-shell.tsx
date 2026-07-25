"use client";

import dynamic from "next/dynamic";
import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DOMAIN_COLORS, STARTER_EDGES, STARTER_NODES, positionForConcept } from "@/lib/concepts";
import { DEPTH_LABELS } from "@/lib/system-prompt";
import type {
  ChatMessage,
  ConceptEdge,
  ConceptNode,
  DepthLevel,
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [mobilePane, setMobilePane] = useState<"chat" | "universe">("chat");
  const [hydrated, setHydrated] = useState(false);
  const [milestone, setMilestone] = useState<TutorResponse["milestone"]>(null);
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
        };
        if (Array.isArray(parsed.messages) && parsed.messages.length) {
          setMessages(parsed.messages);
        }
        if (Array.isArray(parsed.nodes) && parsed.nodes.length) {
          setNodes(parsed.nodes);
        }
        if (Array.isArray(parsed.edges) && parsed.edges.length) {
          setEdges(parsed.edges);
        }
        if (parsed.selectedId) setSelectedId(parsed.selectedId);
        if ([1, 2, 3, 4, 5].includes(Number(parsed.depth))) {
          setDepth(parsed.depth as DepthLevel);
        }
        if (typeof parsed.assignmentContext === "string") {
          setAssignmentContext(parsed.assignmentContext);
          setContextDraft(parsed.assignmentContext);
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setHydrated(true);
    }
  }, []);

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
      }),
    );
  }, [
    assignmentContext,
    depth,
    edges,
    hydrated,
    messages,
    nodes,
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

  const selectedNode = useMemo(
    () =>
      nodes.find((node) => node.id === selectedId) ??
      focusNode ??
      STARTER_NODES[0],
    [focusNode, nodes, selectedId],
  );

  const masteredCount = useMemo(
    () => nodes.filter((node) => node.status === "mastered").length,
    [nodes],
  );

  const prerequisites = useMemo(
    () =>
      edges
        .filter((edge) => edge.to === selectedNode.id)
        .map((edge) => nodes.find((node) => node.id === edge.from))
        .filter((node): node is ConceptNode => Boolean(node))
        .slice(0, 3),
    [edges, nodes, selectedNode.id],
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
    setMilestone(response.milestone);
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
            currentConcept: focusNode?.label ?? "",
            assignmentContext,
            graphSummary,
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
    ],
  );

  const sendMessage = useCallback(
    async (rawMessage: string) => {
      const content = rawMessage.trim();
      if (!content || pending) return;
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
      setMilestone(null);
      await requestTutor(conversation);
    },
    [messages, pending, requestTutor],
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
    const shouldReset = window.confirm(
      "Start a fresh conversation? Your learning universe will stay with you.",
    );
    if (!shouldReset) return;
    const welcome: ChatMessage = {
      id: newId("assistant"),
      role: "assistant",
      content:
        "What are we untangling today? Drop in the topic, problem, or your messiest first thought. I’ll help you find the next step without taking the thinking away from you.",
      timestamp: timeLabel(),
    };
    setMessages([welcome]);
    setQuickReplies([
      "I have a homework problem.",
      "Teach me a concept from scratch.",
      "Help me prepare for an exam.",
    ]);
    setAssignmentContext("");
    setContextDraft("");
    setMilestone(null);
    setError("");
    setMobilePane("chat");
  };

  const studySelected = () => {
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
            <span className="rail-tooltip">New session</span>
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
              <h1>{focusNode?.label ?? "New session"}</h1>
            </div>
          </div>

          <div className="topbar-actions">
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
              aria-label="Start a new session"
            >
              <Icon name="plus" size={16} />
              <span>New session</span>
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
                <h2>{focusNode?.label}</h2>
              </div>
              <div className="understanding-readout">
                <span>{focusNode?.mastery ?? 0}%</span>
                <small>evidence</small>
              </div>
            </div>
            <div
              className="learning-progress"
              role="progressbar"
              aria-label={`Understanding evidence for ${focusNode?.label}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={focusNode?.mastery ?? 0}
            >
              <span style={{ width: `${focusNode?.mastery ?? 0}%` }} />
            </div>

            <div className="message-thread" ref={threadRef}>
              <div className="thread-date">
                <span />
                <p>Today · Structural depth</p>
                <span />
              </div>

              {messages.map((message) => (
                <article
                  className={`message message--${message.role}`}
                  key={message.id}
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
                    <div className="message-content">{message.content}</div>
                  </div>
                </article>
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

              {milestone && (
                <aside className="milestone-card">
                  <div className="milestone-icon">
                    <Icon name="sparkles" size={18} />
                  </div>
                  <div>
                    <span>Milestone summary</span>
                    <h3>{milestone.title}</h3>
                    <p>{milestone.summary}</p>
                  </div>
                </aside>
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
                  <span>/ {focusNode?.label}</span>
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

            <div className="universe-hint">
              <Icon name="orbit" size={15} />
              Drag to orbit · scroll to travel · select a star
            </div>

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
          </section>
        </div>
      </section>

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
