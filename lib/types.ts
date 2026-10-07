export type DepthLevel = 1 | 2 | 3 | 4 | 5;

export type ConceptStatus =
  | "mastered"
  | "learning"
  | "suggested"
  | "locked";

// The tutor's read of the learner's latest message, made before it replies.
export type LearnerState =
  | "correct"
  | "partial"
  | "slip"
  | "misconception"
  | "stuck"
  | "question"
  | "new-topic";

export type ConceptRelation =
  | "prerequisite"
  | "builds-to"
  | "applies-in"
  | "adjacent";

export interface ConceptNode {
  id: string;
  label: string;
  domain: string;
  description: string;
  status: ConceptStatus;
  mastery: number;
  evidence?: string;
  insights?: LearningMilestone[];
}

export interface ConceptEdge {
  from: string;
  to: string;
  relation: ConceptRelation;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  milestone?: LearningMilestone | null;
  learnerState?: LearnerState;
}

export interface ConceptUpdate {
  id: string;
  label: string;
  domain: string;
  description: string;
  status: ConceptStatus;
  mastery: number;
  evidence?: string;
}

export interface RelatedConceptUpdate {
  id: string;
  label: string;
  domain: string;
  description: string;
  relation: ConceptRelation;
  status: "suggested" | "locked";
}

export interface LearningMilestone {
  title: string;
  summary: string;
  masteredConcepts: string[];
}

export interface TutorResponse {
  learnerState: LearnerState | null;
  reply: string;
  focus: ConceptUpdate;
  related: RelatedConceptUpdate[];
  quickReplies: string[];
  milestone: LearningMilestone | null;
}

export type ProviderId =
  | "deepseek"
  | "openai"
  | "anthropic"
  | "google"
  | "custom";

export interface ProviderConfig {
  id: ProviderId;
  model: string;
  apiKey: string;
  baseUrl?: string;
  remember: boolean;
}
