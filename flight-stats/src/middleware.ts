import { NextRequest, NextResponse } from "next/server";

const canonicalHost = "flight-stats-smoky.vercel.app";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const url = request.nextUrl;

  const isLocalhost =
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.endsWith(".github.dev") ||
    host.endsWith(".app.github.dev");

  if (!isLocalhost && host !== canonicalHost) {
    const targetUrl = new URL(url.pathname + url.search, `https://${canonicalHost}`);
    return NextResponse.redirect(targetUrl, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
