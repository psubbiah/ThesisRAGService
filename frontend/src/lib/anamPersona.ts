import {
  ANAM_PERSONA_ID,
  isAllowedAnamPersonaId,
  personaConfig as basePersona,
} from "@/config/persona";
import { readServerEnv } from "@/lib/serverEnv";

/**
 * Build the Anam personaConfig for session-token minting.
 *
 * Prefer an allowlisted personaId from the client. Otherwise use
 * ANAM_PERSONA_ID env, then the built-in default. Ephemeral avatar +
 * cloned voiceId only when ANAM_USE_EPHEMERAL=1 and no persona is selected.
 */
export function buildAnamPersonaConfig(
  requestedPersonaId?: string | null,
): Record<string, unknown> {
  const useEphemeral = readServerEnv("ANAM_USE_EPHEMERAL") === "1";

  const fromClient =
    requestedPersonaId && isAllowedAnamPersonaId(requestedPersonaId)
      ? requestedPersonaId
      : undefined;

  const personaId =
    fromClient ||
    readServerEnv("ANAM_PERSONA_ID") ||
    (!useEphemeral ? ANAM_PERSONA_ID : undefined);

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
