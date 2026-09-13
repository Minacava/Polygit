import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_MODELS,
  resolveModel,
  resolveModelSync,
} from "../../dist/connectors/resolve-model.js";

describe("resolveModel", () => {
  it("prefers CLI over config, env, and default", async () => {
    const prev = process.env.POLYGIT_OLLAMA_MODEL;
    process.env.POLYGIT_OLLAMA_MODEL = "from-env";
    try {
      const resolved = await resolveModel(
        "ollama",
        { models: { ollama: "from-config" } },
        { cliModel: "from-cli", allowOllamaAuto: false },
      );
      assert.equal(resolved.model, "from-cli");
      assert.equal(resolved.source, "cli");
    } finally {
      if (prev === undefined) delete process.env.POLYGIT_OLLAMA_MODEL;
      else process.env.POLYGIT_OLLAMA_MODEL = prev;
    }
  });

  it("uses config before env and default", async () => {
    const prev = process.env.POLYGIT_HF_MODEL;
    process.env.POLYGIT_HF_MODEL = "env/model";
    try {
      const resolved = await resolveModel(
        "huggingface",
        { models: { huggingface: "config/model" } },
        { allowOllamaAuto: false },
      );
      assert.equal(resolved.model, "config/model");
      assert.equal(resolved.source, "config");
    } finally {
      if (prev === undefined) delete process.env.POLYGIT_HF_MODEL;
      else process.env.POLYGIT_HF_MODEL = prev;
    }
  });

  it("uses env before hardcoded default", () => {
    const prev = process.env.POLYGIT_OPENAI_MODEL;
    process.env.POLYGIT_OPENAI_MODEL = "gpt-test";
    try {
      const resolved = resolveModelSync("openai", { models: {} });
      assert.equal(resolved.model, "gpt-test");
      assert.equal(resolved.source, "env");
    } finally {
      if (prev === undefined) delete process.env.POLYGIT_OPENAI_MODEL;
      else process.env.POLYGIT_OPENAI_MODEL = prev;
    }
  });

  it("falls back to built-in defaults", () => {
    const prev = process.env.POLYGIT_CLAUDE_MODEL;
    delete process.env.POLYGIT_CLAUDE_MODEL;
    try {
      const resolved = resolveModelSync("claude", { models: {} });
      assert.equal(resolved.model, DEFAULT_MODELS.claude);
      assert.equal(resolved.source, "default");
    } finally {
      if (prev !== undefined) process.env.POLYGIT_CLAUDE_MODEL = prev;
    }
  });
});
