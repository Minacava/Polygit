import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectForgeFromRemoteUrl,
  isTrustedForgeHost,
  peekRemoteHostname,
} from "../../dist/forge/detect.js";

describe("detectForgeFromRemoteUrl", () => {
  it("detects github.com HTTPS remotes", () => {
    const ref = detectForgeFromRemoteUrl("https://github.com/Minacava/polygit.git");
    assert.equal(ref.kind, "github");
    assert.equal(ref.owner, "Minacava");
    assert.equal(ref.name, "polygit");
    assert.equal(ref.fullPath, "Minacava/polygit");
    assert.equal(ref.host, "api.github.com");
    assert.equal(ref.webBase, "https://github.com");
  });

  it("detects github.com SSH remotes", () => {
    const ref = detectForgeFromRemoteUrl("git@github.com:acme/docs.git");
    assert.equal(ref.kind, "github");
    assert.equal(ref.owner, "acme");
    assert.equal(ref.name, "docs");
  });

  it("detects gitlab.com HTTPS remotes including subgroups", () => {
    const ref = detectForgeFromRemoteUrl(
      "https://gitlab.com/group/subgroup/project.git",
    );
    assert.equal(ref.kind, "gitlab");
    assert.equal(ref.host, "gitlab.com");
    assert.equal(ref.owner, "group");
    assert.equal(ref.name, "project");
    assert.equal(ref.fullPath, "group/subgroup/project");
    assert.equal(ref.webBase, "https://gitlab.com");
  });

  it("detects gitlab.com SSH remotes", () => {
    const ref = detectForgeFromRemoteUrl("git@gitlab.com:org/repo.git");
    assert.equal(ref.kind, "gitlab");
    assert.equal(ref.fullPath, "org/repo");
  });

  it("rejects lookalike github.attacker.com without --forge", () => {
    assert.throws(
      () => detectForgeFromRemoteUrl("https://github.attacker.com/acme/docs.git"),
      /Only github\.com and gitlab\.com|Cannot detect forge|untrusted/i,
    );
  });

  it("rejects lookalike gitlab.evil.io without --forge", () => {
    assert.throws(
      () => detectForgeFromRemoteUrl("https://gitlab.evil.io/team/app.git"),
      /Only github\.com and gitlab\.com|Cannot detect forge|untrusted/i,
    );
  });

  it("rejects github.attacker.com with --forge but without confirmation", () => {
    assert.throws(
      () =>
        detectForgeFromRemoteUrl("https://github.attacker.com/acme/docs.git", {
          forge: "github",
        }),
      /untrusted host|confirm-forge-host|forgeHosts/i,
    );
  });

  it("rejects gitlab.evil.io with --forge but without confirmation", () => {
    assert.throws(
      () =>
        detectForgeFromRemoteUrl("https://gitlab.evil.io/team/app.git", {
          forge: "gitlab",
        }),
      /untrusted host|confirm-forge-host|forgeHosts/i,
    );
  });

  it("allows self-hosted GitLab with --forge and confirmation", () => {
    const ref = detectForgeFromRemoteUrl("https://gitlab.example.com/team/app.git", {
      forge: "gitlab",
      confirmUntrustedHost: true,
    });
    assert.equal(ref.kind, "gitlab");
    assert.equal(ref.host, "gitlab.example.com");
    assert.equal(ref.fullPath, "team/app");
    assert.equal(ref.webBase, "https://gitlab.example.com");
  });

  it("allows GitHub Enterprise with --forge and confirmUntrustedHost", () => {
    const ref = detectForgeFromRemoteUrl(
      "https://github.mycompany.com/acme/docs.git",
      {
        forge: "github",
        confirmUntrustedHost: true,
      },
    );
    assert.equal(ref.kind, "github");
    assert.equal(ref.owner, "acme");
    assert.equal(ref.name, "docs");
    assert.equal(ref.host, "github.mycompany.com");
    assert.equal(ref.webBase, "https://github.mycompany.com");
  });

  it("allows GitHub Enterprise via POLYGIT_FORGE_HOSTS", () => {
    const prev = process.env.POLYGIT_FORGE_HOSTS;
    process.env.POLYGIT_FORGE_HOSTS = "github.mycompany.com";
    try {
      const ref = detectForgeFromRemoteUrl(
        "https://github.mycompany.com/acme/docs.git",
        { forge: "github" },
      );
      assert.equal(ref.kind, "github");
      assert.equal(ref.host, "github.mycompany.com");
    } finally {
      if (prev === undefined) delete process.env.POLYGIT_FORGE_HOSTS;
      else process.env.POLYGIT_FORGE_HOSTS = prev;
    }
  });

  it("rejects unknown forge hosts without --forge", () => {
    assert.throws(
      () => detectForgeFromRemoteUrl("https://bitbucket.org/acme/docs.git"),
      /Cannot detect forge/,
    );
  });

  it("rejects http remotes even for github.com", () => {
    assert.throws(
      () => detectForgeFromRemoteUrl("http://github.com/acme/docs.git"),
      /non-HTTPS|https:\/\//i,
    );
  });

  it("parses ssh:// git URLs", () => {
    const ref = detectForgeFromRemoteUrl("ssh://git@gitlab.com/org/repo");
    assert.equal(ref.kind, "gitlab");
    assert.equal(ref.fullPath, "org/repo");
  });

  it("rejects paths without owner/name", () => {
    assert.throws(() => detectForgeFromRemoteUrl("https://github.com/lonely"), /owner\/name/);
  });

  it("exposes trusted host helpers", () => {
    assert.equal(isTrustedForgeHost("github.com"), true);
    assert.equal(isTrustedForgeHost("gitlab.com"), true);
    assert.equal(isTrustedForgeHost("github.attacker.com"), false);
    assert.equal(isTrustedForgeHost("gitlab.evil.io"), false);
    assert.equal(peekRemoteHostname("https://github.attacker.com/a/b.git"), "github.attacker.com");
  });
});
