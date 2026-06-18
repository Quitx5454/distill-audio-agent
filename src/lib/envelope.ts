// ── Distill Standard Envelope ─────────────────────────────────────────────
// Shared wrapper used by every agent in the Distill ecosystem. Identical
// contract to distill-agent/src/lib/envelope.ts so Distill Audio drops into the
// same composability story (Part 2 will wrap this behind x402). The envelope is
// OPT-IN on input (wrap in `payload`, or send bare input); the response is
// ALWAYS the standard envelope shape.
import { z } from "zod";

export const DISTILL_VERSION = "1.0";

export interface DistillEnvelope<T = unknown> {
  distill_version?: string;
  agent_id?: string;
  session_id?: string;
  payload: T;
}

export interface DistillResponse<O = unknown> {
  distill_version: string;
  agent_id: string | null;
  session_id: string;
  status: "ok" | "error";
  output: O;
  processed_at: string;
}

export interface ParsedEnvelope<T = unknown> {
  isEnvelope: boolean;
  payload: T;
  sessionId: string;
  agentId: string | null;
  distillVersion: string;
}

export function isEnvelope(body: unknown): body is DistillEnvelope {
  return (
    typeof body === "object" &&
    body !== null &&
    "payload" in body &&
    (body as Record<string, unknown>).payload !== undefined
  );
}

export function parseEnvelope<T = unknown>(body: unknown): ParsedEnvelope<T> {
  if (isEnvelope(body)) {
    const env = body as DistillEnvelope<T> & { agent_id?: string | number };
    const sessionId =
      typeof env.session_id === "string" && env.session_id.length > 0
        ? env.session_id
        : crypto.randomUUID();
    const agentId =
      env.agent_id === undefined || env.agent_id === null
        ? null
        : String(env.agent_id);
    return {
      isEnvelope: true,
      payload: env.payload,
      sessionId,
      agentId,
      distillVersion:
        typeof env.distill_version === "string"
          ? env.distill_version
          : DISTILL_VERSION,
    };
  }

  return {
    isEnvelope: false,
    payload: body as T,
    sessionId: crypto.randomUUID(),
    agentId: null,
    distillVersion: DISTILL_VERSION,
  };
}

export function wrapResponse<O>(
  output: O,
  sessionId: string,
  agentId: string | null = null,
  status: "ok" | "error" = "ok",
): DistillResponse<O> {
  return {
    distill_version: DISTILL_VERSION,
    agent_id: agentId,
    session_id: sessionId,
    status,
    output,
    processed_at: new Date().toISOString(),
  };
}

export function withEnvelope<S extends z.ZodTypeAny>(payloadSchema: S) {
  const envelopeShape = z.object({
    distill_version: z.string().optional(),
    agent_id: z.union([z.string(), z.number()]).optional(),
    session_id: z.string().optional(),
    payload: payloadSchema,
  });
  return z.union([envelopeShape, payloadSchema]);
}
