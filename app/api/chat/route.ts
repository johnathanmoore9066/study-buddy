import { NextResponse } from "next/server";
import {
  SOCRATIC_SYSTEM_PROMPT,
  buildSessionContext,
} from "@/lib/system-prompt";
import type {
  ChatMessage,
  ConceptRelation,
  ConceptStatus,
  DepthLevel,
  TutorResponse,
} from "@/lib/types";

export const runtime = "nodejs";

const VALID_RELATIONS = new Set<ConceptRelation>([
  "prerequisite",
  "builds-to",
  "applies-in",
  "adjacent",
]);

const VALID_RELATED_STATUSES = new Set<ConceptStatus>([
  "suggested",
  "locked",
]);

const TUTOR_RESPONSE_TOOL = {
  type: "function",
  function: {
    name: "respond_to_learner",
    description:
      "Deliver the next Socratic tutoring turn and the evidence-based learning-map update.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [
        "reply",
        "focus",
        "related",
        "quickReplies",
        "milestone",
      ],
      properties: {
        reply: {
          type: "string",
          description:
            "Learner-facing tutoring response ending in exactly one question.",
        },
        focus: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "label",
            "domain",
            "description",
            "status",
            "mastery",
            "evidence",
          ],
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            domain: { type: "string" },
            description: { type: "string" },
            status: { type: "string", enum: ["learning"] },
            mastery: { type: "integer", minimum: 0, maximum: 100 },
            evidence: { type: "string" },
          },
        },
        related: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "id",
              "label",
              "domain",
              "description",
              "relation",
              "status",
            ],
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              domain: { type: "string" },
              description: { type: "string" },
              relation: {
                type: "string",
                enum: [
                  "prerequisite",
                  "builds-to",
                  "applies-in",
                  "adjacent",
                ],
              },
              status: {
                type: "string",
                enum: ["suggested", "locked"],
              },
            },
          },
        },
        quickReplies: {
          type: "array",
          maxItems: 3,
          items: { type: "string" },
        },
        milestone: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["title", "summary", "masteredConcepts"],
              properties: {
                title: { type: "string" },
                summary: { type: "string" },
                masteredConcepts: {
                  type: "array",
                  maxItems: 12,
                  items: { type: "string" },
                },
              },
            },
          ],
        },
      },
    },
  },
} as const;

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function asMastery(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function safeId(value: unknown, fallback: string) {
  const normalized = asString(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

function normalizeTutorResponse(value: unknown): TutorResponse {
  const parsed =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const focus =
    parsed.focus && typeof parsed.focus === "object"
      ? (parsed.focus as Record<string, unknown>)
      : {};
  const focusId = safeId(focus.id, "current-topic");

  const related = Array.isArray(parsed.related)
    ? parsed.related
        .slice(0, 3)
        .map((item, index) => {
          const entry =
            item && typeof item === "object"
              ? (item as Record<string, unknown>)
              : {};
          const relation = asString(entry.relation) as ConceptRelation;
          const status = asString(entry.status) as ConceptStatus;
          return {
            id: safeId(entry.id, `related-${index + 1}`),
            label: asString(entry.label, `Related concept ${index + 1}`),
            domain: asString(entry.domain, "General"),
            description: asString(
              entry.description,
              "A related idea worth connecting to this topic.",
            ),
            relation: VALID_RELATIONS.has(relation) ? relation : "adjacent",
            status: (VALID_RELATED_STATUSES.has(status)
              ? status
              : "suggested") as "suggested" | "locked",
          };
        })
    : [];

  const quickReplies = Array.isArray(parsed.quickReplies)
    ? parsed.quickReplies
        .map((item) => asString(item))
        .filter(Boolean)
        .slice(0, 3)
    : [];

  const milestoneSource =
    parsed.milestone && typeof parsed.milestone === "object"
      ? (parsed.milestone as Record<string, unknown>)
      : null;

  return {
    reply: asString(
      parsed.reply,
      "Let’s slow down and isolate the part that feels least certain. What is the first step you trust?",
    ),
    focus: {
      id: focusId,
      label: asString(focus.label, "Current topic"),
      domain: asString(focus.domain, "General"),
      description: asString(
        focus.description,
        "The concept currently carrying the most learning value.",
      ),
      status: "learning",
      mastery: asMastery(focus.mastery),
      evidence: asString(focus.evidence),
    },
    related,
    quickReplies,
    milestone: milestoneSource
      ? {
          title: asString(milestoneSource.title, "Milestone reached"),
          summary: asString(milestoneSource.summary),
          masteredConcepts: Array.isArray(
            milestoneSource.masteredConcepts,
          )
            ? milestoneSource.masteredConcepts
                .map((item) => safeId(item, ""))
                .filter(Boolean)
                .slice(0, 12)
            : [],
        }
      : null,
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "DeepSeek is not connected. Add DEEPSEEK_API_KEY to .env.local and restart the app.",
      },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as {
      messages?: ChatMessage[];
      depth?: number;
      currentConcept?: string;
      assignmentContext?: string;
      graphSummary?: string;
    };

    const messages = Array.isArray(body.messages)
      ? body.messages
          .filter(
            (message) =>
              message &&
              (message.role === "user" || message.role === "assistant") &&
              typeof message.content === "string",
          )
          .slice(-40)
          .map((message) => ({
            role: message.role,
            content: message.content.slice(0, 18_000),
          }))
      : [];

    if (!messages.length || messages.at(-1)?.role !== "user") {
      return NextResponse.json(
        { error: "A learner message is required." },
        { status: 400 },
      );
    }

    const depth = ([1, 2, 3, 4, 5].includes(Number(body.depth))
      ? Number(body.depth)
      : 3) as DepthLevel;

    const upstream = await fetch(
      "https://api.deepseek.com/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL || "deepseek-v4-pro",
          messages: [
            { role: "system", content: SOCRATIC_SYSTEM_PROMPT },
            {
              role: "system",
              content: buildSessionContext({
                depth,
                currentConcept: asString(body.currentConcept),
                assignmentContext: asString(body.assignmentContext).slice(
                  0,
                  36_000,
                ),
                graphSummary: asString(body.graphSummary).slice(0, 12_000),
              }),
            },
            ...messages,
          ],
          thinking: {
            type: "disabled",
          },
          tools: [TUTOR_RESPONSE_TOOL],
          tool_choice: {
            type: "function",
            function: { name: "respond_to_learner" },
          },
          max_tokens: 1800,
        }),
        signal: AbortSignal.timeout(90_000),
      },
    );

    if (!upstream.ok) {
      const upstreamError = await upstream.text();
      console.error(
        "DeepSeek request failed:",
        upstream.status,
        upstreamError.slice(0, 800),
      );
      return NextResponse.json(
        {
          error:
            upstream.status === 401
              ? "DeepSeek rejected the API key. Check the local key and try again."
              : "The tutor could not respond just now. Please try once more.",
        },
        { status: upstream.status === 429 ? 429 : 502 },
      );
    }

    const result = (await upstream.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            function?: {
              name?: string;
              arguments?: string;
            };
          }>;
        };
      }>;
    };
    const message = result.choices?.[0]?.message;
    const toolArguments = message?.tool_calls?.find(
      (call) => call.function?.name === "respond_to_learner",
    )?.function?.arguments;
    const content = toolArguments || message?.content;

    if (!content) {
      throw new Error("DeepSeek returned no learner-facing content.");
    }

    const cleaned = content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    const normalized = normalizeTutorResponse(JSON.parse(cleaned));

    return NextResponse.json(normalized);
  } catch (error) {
    console.error("Tutor route error:", error);
    return NextResponse.json(
      {
        error:
          "The tutor response could not be read. Your message is still here—try sending it again.",
      },
      { status: 500 },
    );
  }
}
