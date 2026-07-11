/**
 * Server-side guard for fetching user-supplied URLs (the /api/image and
 * /api/og proxies). Never import from a client component — uses node:dns.
 *
 * fetchPublicUrl refuses anything that isn't public http(s): non-http
 * schemes, hostnames that resolve to private/reserved addresses, and
 * redirects into the same (each hop is re-validated, since an attacker's
 * public URL can 302 to an internal one). readBodyCapped bounds how much
 * of the response we'll buffer, so a huge body can't exhaust function
 * memory — content-length alone can't be trusted (it's optional and
 * attacker-controlled).
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REDIRECTS = 3;

/** The URL is malformed, non-http(s), or points at a private address. */
export class UnsafeUrlError extends Error {}

/** The response body exceeded the caller's byte cap. */
export class BodyTooLargeError extends Error {}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return true; // "this" / private / loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && (b === 0 || b === 168)) return true; // reserved + private
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true; // benchmarking + doc
  if (a === 203 && b === 0) return true; // documentation
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // IPv4-mapped: judge by the embedded IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (lower === "::" || lower === "::1") return true; // unspecified / loopback
  if (/^fe[89ab]/.test(lower)) return true; // link-local fe80::/10
  if (/^f[cd]/.test(lower)) return true; // unique-local fc00::/7
  return false;
}

/** Throws UnsafeUrlError unless `url` is http(s) on a publicly-routable host. */
async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http(s) URLs are allowed");
  }
  // URL.hostname keeps the brackets on IPv6 literals; strip for isIP/lookup.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(host);
  const addresses = literal
    ? [{ address: host, family: literal }]
    : await lookup(host, { all: true }).catch(() => {
        throw new UnsafeUrlError("Host could not be resolved");
      });
  for (const { address, family } of addresses) {
    const isPrivate = family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);
    if (isPrivate) throw new UnsafeUrlError("URL resolves to a private address");
  }
}

/**
 * fetch() a user-supplied URL, validating the target (and every redirect
 * hop) against assertPublicHost. Pass a timeout via init.signal — it spans
 * all hops. Throws UnsafeUrlError on rejection; otherwise returns the
 * final response.
 */
export async function fetchPublicUrl(rawUrl: string, init?: RequestInit): Promise<Response> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("Invalid URL");
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(current);
    const res = await fetch(current, { ...init, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      if (!location) return res;
      res.body?.cancel();
      try {
        current = new URL(location, current);
      } catch {
        throw new UnsafeUrlError("Invalid redirect target");
      }
      continue;
    }
    return res;
  }
  throw new UnsafeUrlError("Too many redirects");
}

/** Buffer a response body, throwing BodyTooLargeError past `maxBytes`. */
export async function readBodyCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (!res.body) return new Uint8Array();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
