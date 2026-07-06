import { randomBytes } from "node:crypto";

const key = randomBytes(32).toString("base64url");

console.log("TOKEN_ENCRYPTION_KEY=" + key);
console.error("Generated a 32-byte AES-256-GCM key. Store it in your secret manager; do not commit real production keys.");
