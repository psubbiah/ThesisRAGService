"use client";

import {
  AnamEvent,
  ConnectionClosedCode,
  createClient,
  type AnamClient,
  type Message,
} from "@anam-ai/js-sdk";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  ANAM_PERSONA_ID,
  ANAM_PERSONA_OPTIONS,
  type AnamPersonaOptionId,
} from "@/config/persona";
import { THESIS_SHORT_TITLE } from "@/config/thesis";
import { formatSourceLabel, queryRag, type RagSource } from "@/lib/rag";

type ConnectionState = "idle" | "connecting" | "connected" | "error";

function AvatarPersonaPicker({
  selectedPersonaId,
  onChange,
}: {
  selectedPersonaId: AnamPersonaOptionId;
  onChange: (id: AnamPersonaOptionId) => void;
}) {
  return (
    <fieldset className="flex w-full max-w-md flex-col gap-2 text-left">
      <legend className="mb-1 font-[family-name:var(--font-sans)] text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-[#f6f3ee]/80">
        Choose avatar
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {ANAM_PERSONA_OPTIONS.map((option) => {
          const selected = option.id === selectedPersonaId;
          return (
            <label
              key={option.id}
              className={`cursor-pointer border px-3 py-2 transition ${
                selected
                  ? "border-[#f6f3ee] bg-[#f6f3ee]/12"
                  : "border-white/25 hover:border-white/50"
              }`}
            >
              <input
                type="radio"
                name="anam-persona"
                value={option.id}
                checked={selected}
                onChange={() => onChange(option.id)}
                className="sr-only"
              />
              <span className="block font-[family-name:var(--font-sans)] text-sm font-semibold text-[#f6f3ee]">
                {option.label}
              </span>
              <span className="mt-0.5 block font-[family-name:var(--font-serif)] text-xs text-[#f6f3ee]/75">
                {option.description}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

async function fetchSessionToken(personaId: string): Promise<string> {
  const response = await fetch("/api/session-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personaId }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to get session token");
  }
  return data.sessionToken as string;
}

export function ThesisAvatar() {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle");
  const [selectedPersonaId, setSelectedPersonaId] =
    useState<AnamPersonaOptionId>(ANAM_PERSONA_ID);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerMode, setAnswerMode] = useState<string | null>(null);
  const [sources, setSources] = useState<RagSource[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const clientRef = useRef<AnamClient | null>(null);

  const stopSession = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.stopStreaming();
      clientRef.current = null;
    }
    setConnectionState("idle");
    setMessages([]);
  }, []);

  const startSession = useCallback(async () => {
    setConnectionState("connecting");
    setError(null);
    setAnswer(null);
    setAnswerMode(null);
    setSources([]);

    try {
      const sessionToken = await fetchSessionToken(selectedPersonaId);
      const client = createClient(sessionToken);
      clientRef.current = client;

      client.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => {
        setConnectionState("connected");
      });

      client.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, setMessages);

      client.addListener(AnamEvent.CONNECTION_CLOSED, (reason, details) => {
        if (reason !== ConnectionClosedCode.NORMAL) {
          setError(details || `Connection closed: ${reason}`);
          setConnectionState("error");
        } else {
          setConnectionState("idle");
        }
      });

      await client.streamToVideoElement("thesis-avatar-video");

      // Prefer RAG-driven talk(); mute mic so the stock LLM does not compete.
      const maybeMute = (
        client as AnamClient & { muteInputAudio?: () => void }
      ).muteInputAudio;
      maybeMute?.call(client);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start session");
      setConnectionState("error");
    }
  }, [selectedPersonaId]);

  useEffect(() => {
    return () => {
      if (clientRef.current) {
        clientRef.current.stopStreaming();
      }
    };
  }, []);

  const askThesis = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const q = question.trim();
      if (!q || isAsking) return;

      setIsAsking(true);
      setError(null);

      try {
        const rag = await queryRag(q);
        setAnswer(rag.answer);
        setSources(rag.sources || []);
        const meta = rag.metadata || {};
        if (meta.synthesized) {
          setAnswerMode("Paraphrased from thesis sources");
        } else if (meta.rag_mode === "openai-auth-failed") {
          setAnswerMode("OpenAI rejected the API key");
        } else if (
          meta.rag_mode === "openai-missing" ||
          meta.openai_error === "missing_key"
        ) {
          setAnswerMode("OpenAI key missing on server");
        } else if (meta.openai_error === "invalid_api_key") {
          setAnswerMode("OpenAI rejected the API key");
        } else if (meta.openai_error === "quota_or_rate_limit") {
          setAnswerMode("OpenAI quota or rate limit");
        } else if (meta.openai_configured === false) {
          setAnswerMode("Excerpt only — OpenAI key not available to the server");
        } else if (meta.openai_error) {
          setAnswerMode("Excerpt only — model unavailable");
        } else {
          setAnswerMode(
            meta.rag_mode ? `Mode: ${String(meta.rag_mode)}` : null,
          );
        }
        setQuestion("");

        if (clientRef.current && connectionState === "connected") {
          await clientRef.current.talk(rag.answer);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Question failed");
      } finally {
        setIsAsking(false);
      }
    },
    [question, isAsking, connectionState],
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 pb-16 pt-8 sm:px-8">
      <header className="animate-fade-up text-center">
        <p className="font-[family-name:var(--font-sans)] text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">
          Thesis conversation
        </p>
        <hr className="masthead-rule" />
        <h1 className="font-[family-name:var(--font-serif)] text-[1.85rem] leading-tight tracking-[-0.02em] text-[var(--ink)] sm:text-[2.45rem]">
          {THESIS_SHORT_TITLE}
        </h1>
        <p className="mt-2 font-[family-name:var(--font-serif)] text-sm italic text-[var(--muted)] sm:text-base">
          The Moral Logics of Venezuela&apos;s Populist Divide
        </p>
        <hr className="sub-rule" />
        <p className="mx-auto max-w-2xl font-[family-name:var(--font-serif)] text-[1.05rem] italic leading-relaxed text-[var(--muted)]">
          Ask a question drawn from the thesis. An LLM grounds the reply in the
          retrieved chapters, then the avatar speaks it.
        </p>
      </header>

      <section
        className="animate-fade-up relative overflow-hidden border border-[var(--rule)] bg-[var(--panel)] shadow-[var(--shadow)]"
        style={{ animationDelay: "80ms" }}
      >
        <div className="relative aspect-[3/2] w-full bg-[#1a1a1a]">
          <video
            id="thesis-avatar-video"
            autoPlay
            playsInline
            className="h-full w-full object-cover"
          />

          {connectionState !== "connected" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[linear-gradient(180deg,#2a2a2a_0%,#141414_100%)] px-6 text-center">
              {connectionState === "connecting" ? (
                <p className="animate-pulse-soft font-[family-name:var(--font-serif)] text-lg text-[#f6f3ee]">
                  Connecting…
                </p>
              ) : connectionState === "error" ? (
                <>
                  <p className="max-w-md font-[family-name:var(--font-serif)] text-[#f6f3ee]">
                    {error || "Could not start the avatar session."}
                  </p>
                  <AvatarPersonaPicker
                    selectedPersonaId={selectedPersonaId}
                    onChange={setSelectedPersonaId}
                  />
                  <button
                    type="button"
                    onClick={startSession}
                    className="border border-[#f6f3ee] px-5 py-2 font-[family-name:var(--font-sans)] text-sm uppercase tracking-[0.14em] text-[#f6f3ee] transition hover:bg-[#f6f3ee] hover:text-[var(--ink)]"
                  >
                    Try again
                  </button>
                </>
              ) : (
                <>
                  <p className="max-w-sm font-[family-name:var(--font-serif)] text-lg text-[#f6f3ee]">
                    Begin a live session with the thesis avatar.
                  </p>
                  <AvatarPersonaPicker
                    selectedPersonaId={selectedPersonaId}
                    onChange={setSelectedPersonaId}
                  />
                  <button
                    type="button"
                    onClick={startSession}
                    className="bg-[var(--accent)] px-6 py-2.5 font-[family-name:var(--font-sans)] text-sm font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-[var(--accent-dark)]"
                  >
                    Start
                  </button>
                </>
              )}
            </div>
          )}

          {connectionState === "connected" && (
            <button
              type="button"
              onClick={stopSession}
              className="absolute right-3 top-3 border border-white/40 bg-black/45 px-3 py-1.5 font-[family-name:var(--font-sans)] text-xs uppercase tracking-[0.14em] text-white backdrop-blur-sm transition hover:bg-black/65"
            >
              End
            </button>
          )}
        </div>
      </section>

      <section
        className="animate-fade-up border border-[var(--rule)] bg-[var(--panel)] p-5 sm:p-6"
        style={{ animationDelay: "140ms" }}
      >
        <form onSubmit={askThesis} className="flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="thesis-question">
            Ask about the thesis
          </label>
          <input
            id="thesis-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What drives international support for Chavismo?"
            disabled={isAsking}
            className="w-full border border-[var(--rule)] bg-transparent px-4 py-3 font-[family-name:var(--font-serif)] text-base text-[var(--ink)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--ink)] disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!question.trim() || isAsking}
            className="shrink-0 bg-[var(--ink)] px-6 py-3 font-[family-name:var(--font-sans)] text-sm font-semibold uppercase tracking-[0.16em] text-[var(--paper)] transition hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isAsking ? "Searching…" : "Ask"}
          </button>
        </form>
        <p className="mt-3 font-[family-name:var(--font-sans)] text-xs tracking-wide text-[var(--muted)]">
          Retrieval runs against the thesis corpus
          {process.env.NODE_ENV === "development"
            ? " (needs OPENAI_API_KEY for synthesised answers)"
            : ""}{" "}
          {connectionState === "connected"
            ? "The avatar will speak the answer."
            : "Start the avatar to hear the answer spoken; text Q&A works without it."}
        </p>
      </section>

      {(answer || error) && (
        <section
          className="animate-fade-up border-t border-[var(--ink)] pt-5"
          style={{ animationDelay: "40ms" }}
        >
          {error && !answer && (
            <p className="font-[family-name:var(--font-serif)] text-[var(--accent)]">
              {error}
            </p>
          )}
          {answer && (
            <>
              <h2 className="font-[family-name:var(--font-sans)] text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                Answer
              </h2>
              {answerMode && (
                <p className="mt-1 font-[family-name:var(--font-sans)] text-[0.65rem] uppercase tracking-[0.14em] text-[var(--muted)]">
                  {answerMode}
                </p>
              )}
              <p className="mt-2 font-[family-name:var(--font-serif)] text-lg leading-relaxed text-[var(--ink)]">
                {answer}
              </p>
            </>
          )}

          {sources.length > 0 && (
            <div className="mt-6">
              <h3 className="font-[family-name:var(--font-sans)] text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                Sources
              </h3>
              <ol className="mt-3 space-y-3 border-t border-[var(--rule)] pt-3">
                {sources.map((source, index) => (
                  <li
                    key={`${source.title}-${index}`}
                    className="grid grid-cols-[1.5rem_1fr] gap-2"
                  >
                    <span className="font-[family-name:var(--font-serif)] text-sm text-[var(--accent)]">
                      {index + 1}.
                    </span>
                    <div>
                      <p className="font-[family-name:var(--font-sans)] text-sm font-semibold text-[var(--ink)]">
                        {formatSourceLabel(source)}
                      </p>
                      {source.chapter_title &&
                        source.title &&
                        source.title !== source.chapter_title && (
                          <p className="mt-0.5 font-[family-name:var(--font-sans)] text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                            {source.title}
                          </p>
                        )}
                      <p className="mt-1 font-[family-name:var(--font-serif)] text-sm leading-relaxed text-[var(--muted)]">
                        {source.content}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      {connectionState === "connected" && messages.length > 0 && (
        <section className="border-t border-[var(--rule)] pt-4">
          <h2 className="font-[family-name:var(--font-sans)] text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
            Session transcript
          </h2>
          <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
            {messages.map((msg) => (
              <p
                key={msg.id}
                className="font-[family-name:var(--font-serif)] text-sm leading-relaxed text-[var(--ink)]"
              >
                <span className="font-[family-name:var(--font-sans)] text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                  {msg.role === "user" ? "You" : "Avatar"}
                </span>{" "}
                {msg.content}
              </p>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
