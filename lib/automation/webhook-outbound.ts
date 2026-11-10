import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

const privateIpv4 = new BlockList();
for (const [network, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) {
  privateIpv4.addSubnet(network, bits);
}

const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");
const specialIpv6 = new BlockList();
specialIpv6.addSubnet("2001::", 23, "ipv6");
specialIpv6.addSubnet("2001:db8::", 32, "ipv6");
specialIpv6.addSubnet("2002::", 16, "ipv6");
specialIpv6.addSubnet("3fff::", 20, "ipv6");

type Address = { address: string; family: number };
type ResolveAddresses = (hostname: string) => Promise<Address[]>;

function isPublicAddress({ address, family }: Address): boolean {
  if (isIP(address) !== family) return false;
  if (family === 4) return !privateIpv4.check(address);
  return family === 6 && globalIpv6.check(address, "ipv6") && !specialIpv6.check(address, "ipv6");
}

export async function resolveWebhookDestination(
  raw: string,
  resolve: ResolveAddresses = (hostname) => lookup(hostname, { all: true }),
): Promise<{ url: URL; address: Address; servername?: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid webhook URL");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("invalid webhook URL: expected HTTP(S) without credentials");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(hostname);
  let addresses: Address[];
  try {
    addresses = family ? [{ address: hostname, family }] : await resolve(hostname);
  } catch {
    throw new Error("webhook hostname could not be resolved");
  }
  if (!addresses.length || !addresses.every(isPublicAddress)) {
    throw new Error("invalid webhook destination: only public IP addresses are allowed");
  }
  return { url, address: addresses[0], servername: family ? undefined : hostname };
}

export async function postWebhook(
  destination: string,
  payload: string,
  headers: Record<string, string>,
): Promise<number> {
  const signal = AbortSignal.timeout(10_000);
  const { url, address, servername } = await resolveWebhookDestination(destination, (hostname) =>
    new Promise<Address[]>((resolve, reject) => {
      const abort = () => reject(new Error("webhook hostname lookup timed out"));
      signal.addEventListener("abort", abort, { once: true });
      lookup(hostname, { all: true }).then(resolve, reject).finally(() => {
        signal.removeEventListener("abort", abort);
      });
    }),
  );
  return new Promise<number>((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    // Connect to the vetted address directly. Keep the logical host for HTTP and TLS.
    const outgoing = request({
      protocol: url.protocol,
      hostname: address.address,
      family: address.family,
      port: url.port,
      path: url.pathname + url.search,
      method: "POST",
      agent: false,
      servername,
      signal,
      headers: { ...headers, Host: url.host, "Content-Length": Buffer.byteLength(payload) },
    }, (response) => {
      // Only the status is used. Redirects are never followed.
      const deliveryId = headers["x-atlas-delivery-id"];
      const alreadyAccepted = response.statusCode === 409 && deliveryId &&
        response.headers["x-atlas-duplicate-delivery-id"] === deliveryId;
      resolve(alreadyAccepted ? 202 : response.statusCode ?? 0);
      response.destroy();
    });
    outgoing.on("error", () => reject(new Error("webhook request failed")));
    outgoing.end(payload);
  });
}
