/**
 * Anam persona for the thesis avatar.
 *
 * avatarId — custom likeness created from the user's photo in Anam Lab.
 * voiceId  — stock for now; swap after ElevenLabs / Anam voice clone.
 * Spoken thesis answers are driven by RAG via client.talk(), not this LLM.
 */
export const personaConfig = {
  name: "Thesis Guide",
  avatarId: "c1b5de4d-f515-58ab-aa00-75ad40e4f550",
  avatarModel: "cara-4.1-express",
  voiceId: "de23e340-1416-4dd8-977d-065a7ca11697",
  llmId: "a7cf662c-2ace-4de1-a21e-ef0fbf144bb7",
  systemPrompt: [
    "You are the thesis research guide for Parvathi Subbiah's work",
    '"Radical imaginaries of the Bolivarian Revolution".',
    "Keep any unrehearsed replies very brief.",
    "Primary answers are delivered programmatically from a retrieval system.",
  ].join(" "),
} as const;

export const ANAM_AVATAR_ID = personaConfig.avatarId;
