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

export interface TutorResponse {
  reply: string;
  focus: ConceptUpdate;
  related: RelatedConceptUpdate[];
  quickReplies: string[];
  milestone: null | {
    title: string;
    summary: string;
    masteredConcepts: string[];
  };
}
