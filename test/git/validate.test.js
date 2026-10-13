import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSafeCloneUrl,
  assertSafeGitBranch,
  isValidGitBranchName,
} from "../../dist/git/validate.js";

describe("assertSafeGitBranch", () => {
  it("accepts normal branch names", () => {
    assert.equal(assertSafeGitBranch("main"), "main");
    assert.equal(assertSafeGitBranch("polygit/translate-fr-20261013"), "polygit/translate-fr-20261013");
    assert.equal(assertSafeGitBranch("feature/add_docs"), "feature/add_docs");
    assert.equal(isValidGitBranchName("release-1.2"), true);
  });

  it("rejects leading dashes and option-like names", () => {
    assert.throws(() => assertSafeGitBranch("-u"), /must not start with "-"|Invalid branch/i);
    assert.throws(() => assertSafeGitBranch("--upload-pack=evil"), /Invalid branch/i);
    assert.throws(() => assertSafeGitBranch("-main"), /Invalid branch/i);
  });

  it("rejects path tricks and unsafe characters", () => {
    assert.throws(() => assertSafeGitBranch("foo..bar"), /Invalid branch/i);
    assert.throws(() => assertSafeGitBranch("foo@{bar"), /Invalid branch/i);
    assert.throws(() => assertSafeGitBranch("foo bar"), /Invalid branch/i);
    assert.throws(() => assertSafeGitBranch("foo~1"), /Invalid branch/i);
    assert.throws(() => assertSafeGitBranch(""), /Invalid branch/i);
    assert.throws(() => assertSafeGitBranch(" ends"), /Invalid branch/i);
  });
});

describe("assertSafeCloneUrl", () => {
  it("accepts https, ssh, and git@ URLs", () => {
    assert.equal(
      assertSafeCloneUrl("https://github.com/Minacava/Polygit.git"),
      "https://github.com/Minacava/Polygit.git",
    );
    assert.equal(
      assertSafeCloneUrl("ssh://git@gitlab.com/org/repo.git"),
      "ssh://git@gitlab.com/org/repo.git",
    );
    assert.equal(
      assertSafeCloneUrl("git@github.com:Minacava/Polygit.git"),
      "git@github.com:Minacava/Polygit.git",
    );
  });

  it("rejects ext:: and file: URLs", () => {
    assert.throws(
      () => assertSafeCloneUrl("ext::sh -c evil"),
      /ext::/,
    );
    assert.throws(
      () => assertSafeCloneUrl("file:///etc/passwd"),
      /file:/i,
    );
    assert.throws(
      () => assertSafeCloneUrl("file:/tmp/repo.git"),
      /file:/i,
    );
  });

  it("rejects option injection and unsupported protocols", () => {
    assert.throws(() => assertSafeCloneUrl("--upload-pack=evil"), /Rejected clone URL|Unrecognized|Unsupported/i);
    assert.throws(() => assertSafeCloneUrl("git://github.com/acme/docs.git"), /Unsupported|protocol/i);
    assert.throws(() => assertSafeCloneUrl("http://github.com/acme/docs.git"), /Unsupported|protocol/i);
    assert.throws(() => assertSafeCloneUrl("ftp://example.com/repo.git"), /Unsupported|protocol/i);
  });
});
