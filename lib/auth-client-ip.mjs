import { createHmac, timingSafeEqual } from "node:crypto";
import { BlockList, isIP } from "node:net";

const IP_HEADER = "x-atlas-auth-client-ip";
const PROOF_HEADER = "x-atlas-auth-client-proof";
const FORWARDED_FOR = "x-forwarded-for";
// Node already caps request headers; this only bounds our own parsing work.
const MAX_FORWARDED_FOR_BYTES = 8 * 1024;

/** Lower-case an IP literal and normalize IPv4-mapped IPv6 to plain IPv4. */
function normalizeIp(value) {
  if (typeof value !== "string") return null;
  let ip = value.trim();
  if (ip === "") return null;
  if (ip.startsWith("\"") && ip.endsWith("\"") && ip.length >= 2) ip = ip.slice(1, -1).trim();
  if (ip.startsWith("[")) {
    // Forwarded / bracketed IPv6, optionally followed by :port.
    const end = ip.indexOf("]");
    if (end < 0) return null;
    const rest = ip.slice(end + 1);
    if (rest !== "" && !/^:\d{1,5}$/.test(rest)) return null;
    ip = ip.slice(1, end);
  } else {
    // A bare IPv4 address may carry a port in proxy logs. A bare IPv6 address
    // never does, because its final colon is part of the address itself.
    const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(ip);
    if (withPort) ip = withPort[1];
  }
  ip = ip.toLowerCase();
  if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return isIP(ip) ? ip : null;
}

/**
 * Parse one trusted-proxy entry. IPv4-mapped IPv6 is folded to IPv4, including
 * its prefix (`::ffff:192.0.2.0/120` is `192.0.2.0/24`). A mapped prefix below
 * /96 cannot describe a plain IPv4 range, so that entry is rejected.
 */
function parseTrustedEntry(value) {
  let addressText = value;
  let prefixText = null;
  const slash = value.lastIndexOf("/");
  if (slash >= 0) {
    addressText = value.slice(0, slash);
    prefixText = value.slice(slash + 1);
  }

  let address;
  const mapped = /^::ffff:(.+)$/i.exec(addressText);
  const mappedV4 = mapped ? normalizeIp(mapped[1]) : null;
  if (mappedV4 && isIP(mappedV4) === 4) {
    address = mappedV4;
    if (prefixText !== null) {
      if (!/^\d{1,3}$/.test(prefixText)) return null;
      const mappedPrefix = Number(prefixText);
      if (mappedPrefix < 96 || mappedPrefix > 128) return null;
      prefixText = String(mappedPrefix - 96);
    }
  } else {
    address = normalizeIp(addressText);
    if (!address) return null;
  }

  const family = isIP(address);
  const maxPrefix = family === 4 ? 32 : 128;
  let prefix = maxPrefix;
  if (prefixText !== null) {
    if (!/^\d{1,3}$/.test(prefixText)) return null;
    prefix = Number(prefixText);
    if (prefix > maxPrefix) return null;
  }
  return { address, family, prefix };
}

/**
 * Parse ATLAS_TRUSTED_PROXIES. Invalid entries never grant trust; they are
 * reported separately so the server can surface the misconfiguration at boot.
 * An unset/empty value yields `list: null`, which preserves the historical
 * direct-peer behavior exactly.
 */
export function parseTrustedProxies(value) {
  const entries = [];
  const invalid = [];
  if (value === undefined || value === null) return { list: null, entries, invalid };
  const text = Array.isArray(value) ? value.join(",") : String(value);
  for (const item of text.split(",")) {
    const raw = item.trim();
    if (raw === "") continue;
    const parsed = parseTrustedEntry(raw);
    if (!parsed) {
      invalid.push(raw);
      continue;
    }
    entries.push(parsed);
  }
  if (entries.length === 0) return { list: null, entries, invalid };
  const list = new BlockList();
  for (const { address, family, prefix } of entries) {
    list.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
  }
  return {
    list,
    entries: entries.map(({ address, family, prefix }) => (
      prefix === (family === 4 ? 32 : 128) ? address : `${address}/${prefix}`
    )),
    invalid,
  };
}

function trustedProxiesFrom(value) {
  if (value && typeof value === "object" && value.list !== undefined) return value;
  return parseTrustedProxies(value);
}

function isTrustedProxy(trusted, ip) {
  if (!trusted?.list) return false;
  const family = isIP(ip);
  if (family !== 4 && family !== 6) return false;
  try {
    return trusted.list.check(ip, family === 4 ? "ipv4" : "ipv6");
  } catch {
    return false;
  }
}

function forwardedForHeader(request) {
  const headers = request?.headers;
  if (!headers) return "";
  const raw = typeof headers.get === "function" ? headers.get(FORWARDED_FOR) : headers[FORWARDED_FOR];
  if (Array.isArray(raw)) return raw.join(",");
  return typeof raw === "string" ? raw : "";
}

/**
 * Resolve the peer address that rate limiters should use.
 *
 * Only a connection from a configured trusted proxy may contribute XFF. Walking
 * right to left skips trusted hops (the proxies closest to Atlas) and returns
 * the first untrusted address, which is the address NGINX appended for the
 * client. Client-supplied entries to the left therefore cannot choose an
 * identity. If every hop is trusted, the leftmost address is the original
 * client. An unparseable hop encountered before an untrusted address stops the
 * walk and falls back to the socket peer, so malformed forwarding data never
 * grants a spoofable identity.
 */
export function resolveClientIp(request, trustedProxies) {
  const direct = normalizeIp(request?.socket?.remoteAddress);
  if (!direct) return null;
  const trusted = trustedProxiesFrom(trustedProxies);
  if (!isTrustedProxy(trusted, direct)) return direct;

  const forwarded = forwardedForHeader(request);
  if (!forwarded || forwarded.length > MAX_FORWARDED_FOR_BYTES) return direct;

  let leftmost = direct;
  const hops = forwarded.split(",");
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const ip = normalizeIp(hops[index]);
    if (!ip) return direct;
    if (!isTrustedProxy(trusted, ip)) return ip;
    leftmost = ip;
  }
  return leftmost;
}

/** Called only by the custom server, before passing an HTTP request to Next. */
export function stampAuthClientIp(request, key, trustedProxies) {
  delete request.headers[IP_HEADER];
  delete request.headers[PROOF_HEADER];
  const ip = resolveClientIp(request, trustedProxies);
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
