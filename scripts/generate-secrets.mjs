import crypto from "node:crypto";
const token = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
console.log(`BOOKEDRADAR_INGEST_TOKEN=${token()}`);
console.log(`BOOKEDRADAR_ADMIN_TOKEN=${token()}`);
