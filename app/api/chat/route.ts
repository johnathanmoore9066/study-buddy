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
  ProviderConfig,
  ProviderId,
  TutorResponse,
} from "@/lib/types";

export const runtime = "nodejs";

const VALID_PROVIDERS = new Set<ProviderId>([
  "deepseek",
  "openai",
  "anthropic",
  "google",
  "custom",
]);
const VALID_RELATIONS = new Set<ConceptRelation>([
  "prerequisite",
  "builds-to",
  "applies-in",
  "adjacent",
]);
const VALID_RELATED_STATUSES = new Set<ConceptStatus>(["suggested", "locked"]);

const TUTOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "focus", "related", "quickReplies", "milestone"],
  properties: {
    reply: {
      type: "string",
      description: "Learner-facing tutoring response ending in exactly one question.",
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
            enum: ["prerequisite", "builds-to", "applies-in", "adjacent"],
          },
          status: { type: "string", enum: ["suggested", "locked"] },
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
              title: {
                type: "string",
                description:
                  "A short verbatim quote copied from the learner's latest message. Never paraphrase it.",
              },
              summary: {
                type: "string",
                description:
                  "One specific second-person sentence naming the mental model the learner just demonstrated.",
              },
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
} as const;

const TUTOR_RESPONSE_TOOL = {
  type: "function",
  function: {
    name: "respond_to_learner",
    description:
      "Deliver the next Socratic tutoring turn and the evidence-based learning-map update.",
    strict: true,
    parameters: TUTOR_SCHEMA,
  },
} as const;

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function safeId(value: unknown, fallback: string) {
  const normalized = asString(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

function asMastery(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(0, Math.min(100, Math.round(numeric)))
    : 0;
}

function parseJson(content: string) {
  return JSON.parse(
    content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
  ) as unknown;
}

function shortenVerbatim(value: string, maxWords = 14) {
  const matches = Array.from(value.matchAll(/\S+/g));
  if (matches.length <= maxWords) return value.trim();
  const last = matches[maxWords - 1];
  return value.slice(0, (last.index ?? 0) + last[0].length).trim();
}

function milestoneTitle(candidate: unknown, learnerText: string) {
  const source = learnerText.trim();
  if (!source) return "Something clicked";
  const proposed = asString(candidate)
    .replace(/^[“”"'‘’]+|[“”"'‘’]+$/g, "")
    .trim();
  const index = source.toLocaleLowerCase().indexOf(proposed.toLocaleLowerCase());
  if (proposed && index >= 0) {
    return shortenVerbatim(source.slice(index, index + proposed.length));
  }

  const sentences = source.match(/[^.!?\n]+[.!?]?/g) ?? [source];
  const revealing =
    sentences.find((sentence) =>
      /\b(so|because|means|therefore|then|i see|i get|oh)\b/i.test(sentence),
    ) ??
    sentences.at(-1) ??
    source;
  return shortenVerbatim(revealing.trim());
}

function normalizeTutorResponse(
  value: unknown,
  learnerText: string,
): TutorResponse {
  const parsed =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const focus =
    parsed.focus && typeof parsed.focus === "object"
      ? (parsed.focus as Record<string, unknown>)
      : {};
  const focusId = safeId(focus.id, "current-topic");
  const related = Array.isArray(parsed.related)
    ? parsed.related.slice(0, 3).map((item, index) => {
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
  const milestone =
    parsed.milestone && typeof parsed.milestone === "object"
      ? (parsed.milestone as Record<string, unknown>)
      : null;

  return {
    reply: asString(
      parsed.reply,
      "Let’s isolate the part that feels least certain. What is the first step you trust?",
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
    quickReplies: Array.isArray(parsed.quickReplies)
      ? parsed.quickReplies.map((item) => asString(item)).filter(Boolean).slice(0, 3)
      : [],
    milestone: milestone
      ? {
          title: milestoneTitle(milestone.title, learnerText),
          summary: asString(
            milestone.summary,
            "You connected the current idea to a clearer mental model.",
          ).slice(0, 320),
          masteredConcepts: Array.isArray(milestone.masteredConcepts)
            ? milestone.masteredConcepts
                .map((item) => safeId(item, ""))
                .filter(Boolean)
                .slice(0, 12)
            : [],
        }
      : null,
  };
}

function validateCustomUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const privateHost =
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    if (url.protocol !== "https:" || privateHost) return null;
    return url;
  } catch {
    return null;
  }
}

function openAiEndpoint(provider: ProviderConfig) {
  if (provider.id === "deepseek")
    return "https://api.deepseek.com/chat/completions";
  if (provider.id === "openai")
    return "https://api.openai.com/v1/chat/completions";
  const url = validateCustomUrl(provider.baseUrl ?? "");
  if (!url) return null;
  const path = url.pathname.replace(/\/$/, "");
  if (!path.endsWith("/chat/completions")) {
    url.pathname = `${path.endsWith("/v1") ? path : `${path}/v1`}/chat/completions`;
  }
  return url.toString();
}

async function upstreamError(provider: ProviderConfig, response: Response) {
  const label =
    provider.id === "custom"
      ? "The provider"
      : provider.id[0].toUpperCase() + provider.id.slice(1);
  console.error(`${label} request failed:`, response.status);
  return NextResponse.json(
    {
      error:
        response.status === 401 || response.status === 403
          ? `${label} rejected this API key. Open model settings and check it.`
          : response.status === 429
            ? `${label} is rate-limiting this key. Wait a moment and retry.`
            : `${label} could not answer just now. Please try once more.`,
    },
    { status: response.status === 429 ? 429 : 502 },
  );
}

async function callOpenAiCompatible(
  provider: ProviderConfig,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  sessionContext: string,
) {
  const endpoint = openAiEndpoint(provider);
  if (!endpoint) {
    return NextResponse.json(
      { error: "Use a public HTTPS URL for the custom provider." },
      { status: 400 },
    );
  }
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: [
      { role: "system", content: SOCRATIC_SYSTEM_PROMPT },
      { role: "system", content: sessionContext },
      ...messages,
    ],
    tools: [TUTOR_RESPONSE_TOOL],
    tool_choice: {
      type: "function",
      function: { name: "respond_to_learner" },
    },
    [provider.id === "openai" ? "max_completion_tokens" : "max_tokens"]: 1800,
  };
  if (provider.id === "deepseek") body.thinking = { type: "disabled" };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) return upstreamError(provider, response);
  const result = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  };
  const message = result.choices?.[0]?.message;
  const content =
    message?.tool_calls?.find(
      (call) => call.function?.name === "respond_to_learner",
    )?.function?.arguments ?? message?.content;
  if (!content) throw new Error("Provider returned no structured content.");
  return NextResponse.json(
    normalizeTutorResponse(parseJson(content), messages.at(-1)?.content ?? ""),
  );
}

async function callAnthropic(
  provider: ProviderConfig,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  sessionContext: string,
) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 1800,
      system: `${SOCRATIC_SYSTEM_PROMPT}\n\n${sessionContext}`,
      messages,
      tools: [
        {
          name: "respond_to_learner",
          description: TUTOR_RESPONSE_TOOL.function.description,
          input_schema: TUTOR_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: "respond_to_learner" },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) return upstreamError(provider, response);
  const result = (await response.json()) as {
    content?: Array<{ type?: string; name?: string; input?: unknown; text?: string }>;
  };
  const toolUse = result.content?.find(
    (item) => item.type === "tool_use" && item.name === "respond_to_learner",
  );
  const text = result.content?.find((item) => item.type === "text")?.text;
  const value = toolUse?.input ?? (text ? parseJson(text) : null);
  if (!value) throw new Error("Anthropic returned no structured content.");
  return NextResponse.json(
    normalizeTutorResponse(value, messages.at(-1)?.content ?? ""),
  );
}

async function callGoogle(
  provider: ProviderConfig,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  sessionContext: string,
) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(provider.model)}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-goog-api-key": provider.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: `${SOCRATIC_SYSTEM_PROMPT}\n\n${sessionContext}` }],
      },
      contents: messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 1800,
      },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) return upstreamError(provider, response);
  const result = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = result.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("");
  if (!content) throw new Error("Google returned no structured content.");
  return NextResponse.json(
    normalizeTutorResponse(parseJson(content), messages.at(-1)?.content ?? ""),
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      messages?: ChatMessage[];
      depth?: number;
      currentConcept?: string;
      assignmentContext?: string;
      graphSummary?: string;
      provider?: ProviderConfig;
    };
    const provider = body.provider;
    if (
      !provider ||
      !VALID_PROVIDERS.has(provider.id) ||
      !asString(provider.apiKey) ||
      !asString(provider.model)
    ) {
      return NextResponse.json(
        { error: "Connect a model and add your API key before studying." },
        { status: 400 },
      );
    }
    provider.apiKey = provider.apiKey.trim().slice(0, 1024);
    provider.model = provider.model.trim().slice(0, 160);

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
    const sessionContext = buildSessionContext({
      depth,
      currentConcept: asString(body.currentConcept),
      assignmentContext: asString(body.assignmentContext).slice(0, 36_000),
      graphSummary: asString(body.graphSummary).slice(0, 12_000),
    });

    if (provider.id === "anthropic") {
      return await callAnthropic(provider, messages, sessionContext);
    }
    if (provider.id === "google") {
      return await callGoogle(provider, messages, sessionContext);
    }
    return await callOpenAiCompatible(provider, messages, sessionContext);
  } catch (error) {
    console.error(
      "Tutor route error:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return NextResponse.json(
      {
        error:
          "The tutor response could not be read. Your message is still here—try sending it again.",
      },
      { status: 500 },
    );
  }
}
