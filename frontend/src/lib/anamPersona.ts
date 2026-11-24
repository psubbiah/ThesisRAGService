import { personaConfig as basePersona } from "@/config/persona";
import { readServerEnv } from "@/lib/serverEnv";

/**
 * Build the Anam personaConfig for session-token minting.
 *
 * Prefer a saved Lab persona (`ANAM_PERSONA_ID`) when set — that package
 * already includes likeness + voice + Lab prompt.
 * Otherwise send an ephemeral config (avatar + voice + our system prompt),
 * optionally overriding voice with `ANAM_VOICE_ID`.
 */
export function buildAnamPersonaConfig(): Record<string, unknown> {
  const personaId = readServerEnv("ANAM_PERSONA_ID");
  if (personaId) {
    return { personaId };
  }

  const voiceId = readServerEnv("ANAM_VOICE_ID") || basePersona.voiceId;
  const avatarId = readServerEnv("ANAM_AVATAR_ID") || basePersona.avatarId;

  return {
    name: basePersona.name,
    avatarId,
    avatarModel: basePersona.avatarModel,
    voiceId,
    llmId: basePersona.llmId,
    systemPrompt: basePersona.systemPrompt,
  };
}
