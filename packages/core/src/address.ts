/**
 * Who is actually asking: the address a rate limit or a sign-in lockout should count against.
 *
 * `X-Forwarded-For` is written by whoever sends the request, and then appended to by each proxy it
 * passes, so its leftmost entry is the one value in it the client chose. Taking that entry (as this core
 * once did) let anyone sign in ten times a minute per invented address, which is to say without limit.
 *
 * The rule here is the one Caddy's `trusted_proxies private_ranges` uses: start from the socket's peer,
 * and while that peer is a private address — a proxy on our own network — step back one entry in
 * `X-Forwarded-For`. The first public address reached is the client. Behind Traefik and Caddy that is the
 * visitor, because each proxy appended the hop it saw; a forged entry further left is never reached. A
 * core exposed directly has a public peer and ignores the header altogether.
 *
 * On a private network with no proxy, the client's own address is private, so the walk continues into
 * whatever the client wrote. That is a development setup, and the account lockout still holds there.
 */
import { isIP } from "node:net";

/** An address as written in a header or by a socket, normalised; null when it is not one. */
export function normalise(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (s.startsWith("[")) s = s.slice(1, s.indexOf("]"));          // [::1]:443
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(s)) s = s.split(":")[0]; // 10.0.0.7:5173
  if (s.toLowerCase().startsWith("::ffff:") && isIP(s.slice(7)) === 4) s = s.slice(7);
  return isIP(s) ? s.toLowerCase() : null;
}

/** Loopback, private, link-local and carrier-grade NAT: where a proxy of ours would be, never a visitor on the internet. */
export function isPrivate(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a === 0;
  }
  return ip === "::1" || ip === "::" || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
}

export function clientAddress(socket: string | undefined | null, forwardedFor: string | undefined | null): string {
  let ip = normalise(socket);
  const hops = (forwardedFor ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  // No socket address (a runtime that does not say) is treated as a proxy: walking from the right is still
  // far better than believing the left.
  while ((ip === null || isPrivate(ip)) && hops.length) {
    const next = normalise(hops.pop());
    if (!next) break;
    ip = next;
  }
  return ip ?? "unknown";
}
