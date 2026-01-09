import crypto from "crypto";

export function base64url(input) {
  return input
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function randomString(bytes = 32) {
  return base64url(crypto.randomBytes(bytes));
}

export function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest();
}

export function pkceChallengeFromVerifier(verifier) {
  return base64url(sha256(Buffer.from(verifier)));
}
