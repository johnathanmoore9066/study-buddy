import type {
  ChatMessage,
  ConceptEdge,
  ConceptNode,
  LearnerState,
} from "@/lib/types";

export const MASTERED_AT = 75;

// How far evidence may rise in one turn, given what the learner's latest
// message actually showed. Asking a question or being stuck is not evidence.
const RISE_LIMIT: Record<LearnerState, number> = {
  correct: 12,
  partial: 6,
  slip: 6,
  misconception: 0,
  stuck: 0,
  question: 0,
  "new-topic": 0,
};
const UNASSESSED_RISE = 12;
const DROP_LIMIT = 15;
const MILESTONE_BONUS = 8;
const MILESTONE_BOOST = 12;
const NEW_CONCEPT_CEILING = 30;

/**
 * The model proposes an evidence score each turn; this keeps it honest. It can
 * only rise as far as the learner's latest message justifies and cannot swing
 * wildly between turns, so one lucky answer never marks a concept mastered.
 */
export function nextMastery({
  previous,
  proposed,
  learnerState,
  milestone,
}: {
  previous?: number;
  proposed: number;
  learnerState: LearnerState | null;
  milestone: boolean;
}) {
  if (previous === undefined) return Math.min(proposed, NEW_CONCEPT_CEILING);
  const rise =
    (learnerState ? RISE_LIMIT[learnerState] : UNASSESSED_RISE) +
    (milestone ? MILESTONE_BONUS : 0);
  const bounded = Math.min(previous + rise, Math.max(proposed, previous - DROP_LIMIT));
  return Math.max(0, Math.min(100, bounded));
}

/**
 * Where a concept stands once the tutor's focus moves on, after any evidence a
 * milestone credited to it. Credited concepts are at least within reach.
 */
export function settleConcept(node: ConceptNode, credited: boolean): ConceptNode {
  const mastery = credited ? Math.min(100, node.mastery + MILESTONE_BOOST) : node.mastery;
  let status = node.status;
  if (status === "learning" || (credited && mastery >= MASTERED_AT)) {
    status = mastery >= MASTERED_AT ? "mastered" : "suggested";
  } else if (credited && status === "locked") {
    status = "suggested";
  }
  return mastery === node.mastery && status === node.status
    ? node
    : { ...node, mastery, status };
}

function conceptKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\b(\w{2,}[^s\s])s\b/g, "$1");
}

/**
 * Maps a concept the tutor names onto one already in the learning map when it
 * is the same idea under a different id ("limit" for "limits", or a label that
 * matches an existing concept's label).
 */
export function resolveConceptId(nodes: ConceptNode[], id: string, label: string) {
  if (nodes.some((node) => node.id === id)) return id;
  const keys = [conceptKey(label), conceptKey(id.replace(/-/g, " "))].filter(Boolean);
  const match = nodes.find((node) =>
    [conceptKey(node.label), conceptKey(node.id.replace(/-/g, " "))].some((key) =>
      keys.includes(key),
    ),
  );
  return match?.id ?? id;
}

/**
 * Reuses an existing subject name when the tutor writes a variant of it, such
 * as "math" or "Math" for "Mathematics", so it does not spawn a second star.
 */
export function resolveDomain(nodes: ConceptNode[], domain: string) {
  const wanted = domain.trim().toLowerCase();
  if (!wanted) return domain;
  const subjects = Array.from(new Set(nodes.map((node) => node.domain)));
  const match =
    subjects.find((subject) => subject.toLowerCase() === wanted) ??
    subjects.find((subject) => {
      const known = subject.toLowerCase();
      const [shorter, longer] = known.length < wanted.length ? [known, wanted] : [wanted, known];
      return shorter.length >= 4 && longer.startsWith(shorter);
    });
  return match ?? domain;
}

/**
 * The learning map as the tutor reads it, one concept per line. The focus and
 * its neighbours come first, then the newest concepts, so the server's length
 * cap drops the least relevant lines.
 */
export function summarizeMap(nodes: ConceptNode[], edges: ConceptEdge[], focusId: string) {
  const neighbours = new Set<string>();
  edges.forEach((edge) => {
    if (edge.from === focusId) neighbours.add(edge.to);
    if (edge.to === focusId) neighbours.add(edge.from);
  });
  const rank = (node: ConceptNode) =>
    node.id === focusId ? 0 : neighbours.has(node.id) ? 1 : 2;
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => rank(a.node) - rank(b.node) || b.index - a.index)
    .map(
      ({ node }) =>
        `${node.id}: ${node.label} [${node.domain}] (${node.status}, ${node.mastery}%)`,
    )
    .join("\n");
}

/** Consecutive tutor turns that judged the learner stuck or holding a misconception. */
export function struggleStreak(messages: ChatMessage[]) {
  let streak = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    if (message.learnerState !== "stuck" && message.learnerState !== "misconception") {
      break;
    }
    streak += 1;
  }
  return streak;
}
