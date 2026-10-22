import crypto from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { tokenQueryParam } from "@prepare-to-interview/shared";

/** The cookie holding the token; it names the port, since browsers share cookies across the ports of a host. */
function cookieName(host: string): string {
  return `pti_token_${host.split(":").at(-1) ?? ""}`;
}

/**
 * DNS-rebinding guard: only requests addressed to the loopback host and port pass, and a
 * browser Origin, when present, must be the app itself.
 */
export function hostGuard(allowedHosts: () => ReadonlySet<string>): MiddlewareHandler {
  return async (c, next) => {
    const hosts = allowedHosts();
    const host = c.req.header("host") ?? "";
    if (!hosts.has(host)) return c.text("Forbidden host", 403);
    const origin = c.req.header("origin");
    if (origin !== undefined && !hosts.has(originHost(origin))) return c.text("Forbidden origin", 403);
    await next();
  };
}

/**
 * Every request needs the token: as a bearer header (agents, scripts) or as the cookie a browser
 * receives after opening the tokenized URL once.
 */
export function tokenGuard(token: string): MiddlewareHandler {
  const matches = (candidate: string | undefined) => sameToken(candidate, token);
  return async (c, next) => {
    const bearer = bearerToken(c.req.header("authorization"));
    // hostGuard runs first, so the host names the app's own port.
    const cookie = cookieName(c.req.header("host") ?? "");
    if (matches(bearer) || matches(getCookie(c, cookie))) {
      await next();
      return;
    }
    if (c.req.method === "GET" && matches(c.req.query(tokenQueryParam))) {
      setCookie(c, cookie, token, { httpOnly: true, sameSite: "Strict", path: "/" });
      const url = new URL(c.req.url);
      url.searchParams.delete(tokenQueryParam);
      return c.redirect(url.pathname + url.search, 302);
    }
    return c.text("Unauthorized: open the URL printed by `pnpm start`.", 401);
  };
}

export function bearerToken(header: string | undefined): string | undefined {
  return header?.match(/^Bearer (.+)$/)?.[1];
}

/** Whether `candidate` is `token`, compared in constant time. */
export function sameToken(candidate: string | undefined, token: string): boolean {
  return candidate !== undefined && safeEqual(candidate, token);
}

function originHost(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return "";
  }
}

function safeEqual(a: string, b: string): boolean {
  const digest = (value: string) => crypto.createHash("sha256").update(value).digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}
