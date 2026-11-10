import { describe, expect, test } from "bun:test";
import { clientAddress, isPrivate, normalise } from "../src/address.ts";

describe("who is asking", () => {
  test("behind Traefik and Caddy, the visitor is the address Traefik saw, whatever they wrote to the left", () => {
    // the visitor forged 6.6.6.6; Traefik appended what it saw (203.0.113.9); Caddy appended Traefik (10.0.1.4)
    expect(clientAddress("172.18.0.3", "6.6.6.6, 203.0.113.9, 10.0.1.4")).toBe("203.0.113.9");
  });

  test("a core on the internet ignores the header: its peer is the client", () => {
    expect(clientAddress("198.51.100.20", "6.6.6.6")).toBe("198.51.100.20");
  });

  test("forging a private hop does not walk past the real client", () => {
    expect(clientAddress("10.0.0.2", "10.9.9.9, 203.0.113.9")).toBe("203.0.113.9");
  });

  test("addresses are compared as addresses: ports, brackets and IPv4-mapped IPv6 are stripped", () => {
    expect(normalise("[::1]:443")).toBe("::1");
    expect(normalise("10.0.0.7:5173")).toBe("10.0.0.7");
    expect(normalise("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(normalise("not an address")).toBeNull();
    expect(clientAddress("::ffff:127.0.0.1", "203.0.113.9")).toBe("203.0.113.9");
  });

  test("a header that is not an address stops the walk rather than being believed", () => {
    expect(clientAddress("127.0.0.1", "203.0.113.9, garbage")).toBe("127.0.0.1");
  });

  test("private means where a proxy of ours would be", () => {
    for (const ip of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "127.0.0.1", "100.64.0.1", "::1", "fd00::1", "fe80::1"]) expect({ ip, p: isPrivate(ip) }).toEqual({ ip, p: true });
    for (const ip of ["172.32.0.1", "8.8.8.8", "203.0.113.9", "2001:db8::1"]) expect({ ip, p: isPrivate(ip) }).toEqual({ ip, p: false });
  });
});
