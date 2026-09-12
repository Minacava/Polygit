import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectForgeFromRemoteUrl } from "../../dist/forge/detect.js";

describe("detectForgeFromRemoteUrl", () => {
  it("detects github.com HTTPS remotes", () => {
    const ref = detectForgeFromRemoteUrl("https://github.com/Minacava/Polygit.git");
    assert.equal(ref.kind, "github");
    assert.equal(ref.owner, "Minacava");
    assert.equal(ref.name, "Polygit");
    assert.equal(ref.fullPath, "Minacava/Polygit");
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

  it("treats non-GitHub hosts as GitLab (self-hosted)", () => {
    const ref = detectForgeFromRemoteUrl(
      "https://gitlab.example.com/team/app.git",
    );
    assert.equal(ref.kind, "gitlab");
    assert.equal(ref.host, "gitlab.example.com");
    assert.equal(ref.fullPath, "team/app");
  });

  it("parses ssh:// git URLs", () => {
    const ref = detectForgeFromRemoteUrl("ssh://git@gitlab.com/org/repo");
    assert.equal(ref.kind, "gitlab");
    assert.equal(ref.fullPath, "org/repo");
  });

  it("rejects paths without owner/name", () => {
    assert.throws(() => detectForgeFromRemoteUrl("https://github.com/lonely"), /owner\/name/);
  });
});
