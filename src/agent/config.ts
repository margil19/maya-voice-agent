// Maya's full Retell configuration, generated from code: prompt, model, voice,
// tools (built from the same zod schemas the backend validates against), and
// the post-call analysis fields that feed the scorecard.

import type { AgentCreateParams } from "retell-sdk/resources/agent";
import type { LlmCreateParams } from "retell-sdk/resources/llm";
import { toolDefinitions } from "@/lib/clinic/tools";
import { BEGIN_MESSAGE, GENERAL_PROMPT, PROMPT_VERSION } from "./prompt";

export const AGENT_NAME = "Maya – Harbor Orthopedics Billing";
export type Model = NonNullable<LlmCreateParams["model"]>;
// gpt-4.1 (non-reasoning): no narration and faster replies in real-call replays.
// Sonnet 5.5 explained well but spoke its reasoning aloud in about half of conversations.
export const MODEL: Model = "gpt-4.1";
// Chosen by ear: 11labs-Merritt (heard as harsh) → retell-Kate → minimax-Grace,
// picked in the Retell dashboard after test calls and copied here.
export const VOICE_ID = "minimax-Grace";

// What Maya says while a tool runs (only used for the slower, multi-step ones).
// A fixed line for every tool, so the agent never improvises (and narrates)
// around tool calls. Found in real calls and replays: free-form pre-tool text
// was where "The caller said..., so I'll send that" leaks came from.
const SPEAK_DURING: Partial<Record<string, string>> = {
  verify_patient: "Thanks, one moment while I find your account.",
  get_statement: "Let me pull up your statement.",
  get_claim_status: "Let me check that claim with insurance.",
  send_payment_link: "Sending that over now.",
  create_payment_plan: "Let me set that up for you.",
  update_insurance: "I'm updating that now.",
  create_ticket: "Let me note all of that for our billing team.",
  transfer_to_human: "Of course, let me get someone for you.",
};

export function llmConfig(baseUrl: string, model: Model = MODEL): LlmCreateParams {
  const tools: NonNullable<LlmCreateParams["general_tools"]> = toolDefinitions().map((t) => {
    // Retell wants a plain JSON Schema object; drop the $schema marker.
    const { $schema: _ignored, ...parameters } = t.parameters as Record<string, unknown>;
    void _ignored;
    const during = SPEAK_DURING[t.name];
    return {
      type: "custom" as const,
      name: t.name,
      description: t.description,
      url: `${baseUrl}/api/tools/${t.name}`,
      method: "POST" as const,
      parameters: parameters as { type: "object"; properties: unknown },
      speak_during_execution: Boolean(during),
      ...(during ? { execution_message_description: during, execution_message_type: "static_text" as const } : {}),
      speak_after_execution: true,
      timeout_ms: 10_000,
    };
  });

  tools.push({
    type: "end_call",
    name: "end_call",
    description: "End the call after recapping and confirming the caller has nothing else, or right after a transfer.",
  });

  return {
    model,
    model_temperature: 0.2,
    start_speaker: "agent",
    begin_message: BEGIN_MESSAGE,
    general_prompt: GENERAL_PROMPT,
    general_tools: tools,
  };
}

export function agentConfig(
  llmId: string,
  opts: { name?: string; voiceId?: string } = {},
): AgentCreateParams {
  return {
    agent_name: opts.name ?? AGENT_NAME,
    response_engine: { type: "retell-llm", llm_id: llmId },
    voice_id: opts.voiceId ?? VOICE_ID,
    // Expressive mode lets the voice carry warmth instead of a flat read
    // (first real calls: "harsh... like she's doing you a favour").
    enable_expressive_mode: true,
    expressive_mode_prompt:
      "Warm, calm and reassuring, like a kind front-desk person who genuinely wants to help. Gentle and slower with upset or worried callers; light and friendly when things are going well. Never curt.",
    language: "en-US",
    vocab_specialization: "medical",
    timezone: "America/New_York",
    // Tuned in the Retell dashboard after test calls, copied here so syncs keep them:
    // a soft call-center background (sounds like a real billing office) and fast turn-taking.
    ambient_sound: "call-center",
    ambient_sound_volume: 0.8,
    responsiveness: 1,
    enable_backchannel: true,
    // v8 (dashboard): lowered from 0.85; at 0.85 small sounds on the caller's line
    // made Maya stop mid-word, which callers heard as choppy speech.
    interruption_sensitivity: 0.75,
    // Retell's built-in speaking behaviours. v8 (dashboard): filler words and the
    // "conversational personality" turned off; together they produced "um... uh..."
    // mid-sentence, heard as Maya breaking her words.
    handbook_config: {
      ai_disclosure: true,
      conversational_personality: false,
      default_personality: false,
      echo_verification: true,
      high_empathy: true,
      nato_phonetic_alphabet: true,
      natural_filler_words: false,
      scope_boundaries: true,
      smart_matching: true,
      speech_normalization: true,
    },
    end_call_after_silence_ms: 30_000,
    max_call_duration_ms: 15 * 60 * 1000,
    boosted_keywords: ["Harbor", "Orthopedics", "deductible", "coinsurance", "copay", "Aetna", "Cigna", "Oscar", "UnitedHealthcare", "Empire"],
    version_description: `Prompt ${PROMPT_VERSION}`,
    post_call_analysis_data: [
      {
        type: "enum",
        name: "primary_intent",
        description: "The main reason the caller called.",
        choices: ["explain_bill", "pay_now", "payment_plan", "insurance_issue", "hardship", "out_of_scope", "unknown"],
      },
      {
        type: "boolean",
        name: "resolved_without_human",
        description: "True if the caller's need was fully handled by Maya with no transfer, callback or ticket needed.",
      },
      {
        type: "boolean",
        name: "escalated",
        description: "True if Maya transferred the call, booked a callback, or created a ticket for the billing team.",
      },
      {
        type: "number",
        name: "dollars_committed",
        description: "Total dollars the caller committed to: payment link amount plus payment plan total. 0 if none.",
      },
      {
        type: "enum",
        name: "caller_sentiment_end",
        description: "The caller's mood at the end of the call.",
        choices: ["positive", "neutral", "negative"],
      },
      {
        type: "string",
        name: "compliance_concern",
        description:
          "Describe any moment Maya discussed account details before verification, accepted card numbers, promised a write-off or insurance outcome, or gave medical advice. Write 'none' if there were none.",
      },
    ],
  };
}
