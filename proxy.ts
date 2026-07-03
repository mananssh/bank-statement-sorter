import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  passphraseIsSet,
  verifySessionCookie,
} from "@/lib/security/session";

/**
 * Local-first security gate:
 *  1. Host allowlist — only localhost is served, which also blocks
 *     DNS-rebinding attacks that use a hostile hostname on a local port.
 *  2. Optional passphrase session — when a passphrase file exists, every
 *     route except /unlock requires a valid HMAC session cookie.
 */

const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!ALLOWED_HOSTS.test(host)) {
    return new NextResponse("Forbidden: statement-sorter only serves localhost", { status: 403 });
  }

  const { pathname } = request.nextUrl;
  if (pathname === "/unlock") return NextResponse.next();

  if (passphraseIsSet()) {
    const cookie = request.cookies.get(SESSION_COOKIE)?.value;
    if (!verifySessionCookie(cookie)) {
      const url = request.nextUrl.clone();
      url.pathname = "/unlock";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|ico)$).*)"],
};
