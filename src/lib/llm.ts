export type LlmJsonResult = {
  ok: true;
  data: unknown;
  model: string;
} | {
  ok: false;
  reason: string;
};

export function llmConfigured(): boolean {
  return Boolean(llmApiKey());
}

function llmApiKey(): string | undefined {
  return (
    process.env.LLM_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.NEON_AI_API_KEY?.trim() ||
    undefined
  );
}

function llmBaseUrl(): string {
  return (
    process.env.LLM_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    process.env.NEON_AI_BASE_URL?.trim() ||
    "https://api.openai.com/v1"
  );
}

function llmModel(): string {
  return process.env.LLM_MODEL?.trim() || "gpt-4o-mini";
}

export async function completeJson(system: string, user: string): Promise<LlmJsonResult> {
  const apiKey = llmApiKey();
  if (!apiKey) {
    return { ok: false, reason: "LLM_API_KEY is not set" };
  }
  const url = `${llmBaseUrl().replace(/\/+$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: llmModel(),
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, reason: `LLM HTTP ${response.status}` };
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return { ok: false, reason: "Empty LLM response" };
    return { ok: true, data: JSON.parse(extractJson(content)), model: llmModel() };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "LLM request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? text).trim();
}
