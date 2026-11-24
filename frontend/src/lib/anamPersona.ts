import {
  ANAM_PERSONA_ID,
  personaConfig as basePersona,
} from "@/config/persona";
import { readServerEnv } from "@/lib/serverEnv";

/**
 * Build the Anam personaConfig for session-token minting.
 *
 * Default: saved Lab persona (likeness + cloned voice + Lab prompt).
 * Override with ANAM_PERSONA_ID env, or fall back to ephemeral avatar +
 * cloned voiceId if ANAM_USE_EPHEMERAL=1.
 */
export function buildAnamPersonaConfig(): Record<string, unknown> {
  const useEphemeral = readServerEnv("ANAM_USE_EPHEMERAL") === "1";
  const personaId =
    readServerEnv("ANAM_PERSONA_ID") || (!useEphemeral ? ANAM_PERSONA_ID : undefined);

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
