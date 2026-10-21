import crypto from "node:crypto";

/** Full SHA-256 hex digest of a UTF-8 string (document content hashing). */
export function sha256Text(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}
