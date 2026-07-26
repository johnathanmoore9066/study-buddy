import type { ProviderId } from "@/lib/types";

export interface ProviderPreset {
  id: ProviderId;
  name: string;
  model: string;
  keyPlaceholder: string;
  inputPrice: string;
  outputPrice: string;
  detail: string;
  pricingUrl: string;
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    model: "deepseek-v4-pro",
    keyPlaceholder: "sk-…",
    inputPrice: "$0.435",
    outputPrice: "$0.87",
    detail: "V4 Pro · cache hits $0.003625 / 1M",
    pricingUrl: "https://api-docs.deepseek.com/quick_start/pricing",
  },
  {
    id: "openai",
    name: "OpenAI",
    model: "gpt-5.6-sol",
    keyPlaceholder: "sk-…",
    inputPrice: "$5",
    outputPrice: "$30",
    detail: "GPT-5.6 Sol",
    pricingUrl: "https://developers.openai.com/api/docs/models",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    model: "claude-fable-5",
    keyPlaceholder: "sk-ant-…",
    inputPrice: "$10",
    outputPrice: "$50",
    detail: "Claude Fable 5",
    pricingUrl:
      "https://platform.claude.com/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5",
  },
  {
    id: "google",
    name: "Google",
    model: "gemini-3.6-flash",
    keyPlaceholder: "AIza…",
    inputPrice: "$1.50",
    outputPrice: "$7.50",
    detail: "Gemini 3.6 Flash",
    pricingUrl: "https://ai.google.dev/gemini-api/docs/pricing",
  },
  {
    id: "custom",
    name: "Other",
    model: "",
    keyPlaceholder: "Your API key",
    inputPrice: "Varies",
    outputPrice: "Varies",
    detail: "OpenAI-compatible HTTPS endpoint",
    pricingUrl: "",
  },
];

export function providerName(id: ProviderId) {
  return PROVIDERS.find((provider) => provider.id === id)?.name ?? "Provider";
}
