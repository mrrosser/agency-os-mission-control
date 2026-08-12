import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PREFERENCE_PAGE_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
].join("; ");

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  if (
    request.nextUrl.pathname === "/preferences" ||
    request.nextUrl.pathname === "/preferences/"
  ) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Content-Security-Policy", PREFERENCE_PAGE_CSP);
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set(
      "Permissions-Policy",
      "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
    );
  }
  return response;
}
