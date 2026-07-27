export type DepthLevel = 1 | 2 | 3 | 4 | 5;

export type ConceptStatus =
  | "mastered"
  | "learning"
  | "suggested"
  | "locked";

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
  position: [number, number, number];
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
