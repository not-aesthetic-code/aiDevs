/**
 * common config
 * Tylko zmienne używane w więcej niż jednym zadaniu.
 */

export const config = {
 // default model
  llm: {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8192,
  },

  // hub: endpoint verification
  hub: {
    verify_url: "https://hub.ag3nts.org/verify",
  },
} as const;
