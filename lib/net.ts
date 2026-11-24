// SSRF guard: refuses hosts that are, or resolve to, non-public addresses.
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["::ffff:0:0:0", 96], // IPv4-translated (SIIT)
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001::", 23], // IETF protocol assignments (Teredo, ORCHID, ...)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** True for private, loopback, link-local, CGNAT and reserved addresses, including IPv4-mapped IPv6 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family !== 6) return true; // not an IP address: fail closed
  if (blocked.check(address, "ipv6")) return true; // BlockList also matches ::ffff:a.b.c.d against the IPv4 rules
  // IPv4-compatible (::a.b.c.d) addresses, which BlockList does not map
  const m = /^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (m) {
    const hi = parseInt(m[1], 16);
    const lo = parseInt(m[2], 16);
    return blocked.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, "ipv4");
  }
  return false;
}

/** Hostname as found in URL.hostname -> bare lowercase name or IP literal */
function bare(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

/** Check on the name alone, no DNS: local names and IP literals */
export function isPrivateHost(hostname: string): boolean {
  const h = bare(hostname);
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  return isIP(h) ? isBlockedAddress(h) : false;
}

/** Resolves the host and returns false if any of its addresses is not public (or it does not resolve) */
export async function resolvesToPublic(hostname: string): Promise<boolean> {
  if (isPrivateHost(hostname)) return false;
  const h = bare(hostname);
  if (isIP(h)) return true;
  try {
    const addrs = await lookup(h, { all: true, verbatim: true });
    return addrs.length > 0 && addrs.every((a) => !isBlockedAddress(a.address));
  } catch {
    return false;
  }
}
