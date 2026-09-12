# E05 — LLM connectors (Claude + OpenAI)

**Goal:** Pluggable `TranslationProvider` with chat-message style connectors.

## Tasks

- [ ] Define `src/connectors/provider.ts` (`translateSegment(text, sourceLang, targetLang, context?)`)
- [ ] Implement `src/connectors/claude.ts` (Anthropic Messages API, key from `.env`)
- [ ] Implement `src/connectors/openai.ts` (Chat Completions, key from `.env`)
- [ ] Inject glossary / TM hints via `context` without leaking secrets into logs
- [ ] Timeouts, non-zero exit on auth errors, redact API keys in error output
- [ ] Security audit: no keys in repo; document `.env.example` only

## Depends on

- E01
