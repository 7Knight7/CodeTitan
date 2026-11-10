import { NextResponse } from "next/server";

// Sends visitors without a session cookie to the sign-in page.
// The cookie's signature is verified by the API on every request; this is only the page-level gate.
export function middleware(req) {
  if (req.cookies.get("lbc_session")) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!login|api|_next|favicon.ico).*)"] };
