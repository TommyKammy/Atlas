import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

const IP_HEADER = "x-atlas-auth-client-ip";
const PROOF_HEADER = "x-atlas-auth-client-proof";

function normalizeIp(value) {
  if (typeof value !== "string") return null;
  const ip = value.startsWith("::ffff:") && isIP(value.slice(7)) === 4 ? value.slice(7) : value.toLowerCase();
  return isIP(ip) ? ip : null;
}

/** Called only by the custom server, before passing an HTTP request to Next. */
export function stampAuthClientIp(request, key) {
  delete request.headers[IP_HEADER];
  delete request.headers[PROOF_HEADER];
  const ip = normalizeIp(request.socket?.remoteAddress);
  if (!ip || !/^[a-f0-9]{64}$/.test(key ?? "")) return;
  request.headers[IP_HEADER] = ip;
  request.headers[PROOF_HEADER] = createHmac("sha256", key).update(ip).digest("hex");
}

/** Unattested headers (including next dev/start and forwarded headers) are ignored. */
export function verifiedAuthClientIp(request, key = process.env.ATLAS_INTERNAL_AUTH_IP_KEY) {
  const ip = normalizeIp(request.headers.get(IP_HEADER));
  const proof = request.headers.get(PROOF_HEADER);
  if (!ip || !/^[a-f0-9]{64}$/.test(key ?? "") || !/^[a-f0-9]{64}$/.test(proof ?? "")) return null;
  const expected = createHmac("sha256", key).update(ip).digest();
  return timingSafeEqual(expected, Buffer.from(proof, "hex")) ? ip : null;
}
