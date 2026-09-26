import { auth } from "@/lib/auth";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = [
  "/",
  "/login",
  "/api/health",
  "/api/auth",
];

function isPublic(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some(
    (p) => p !== "/" && (pathname === p || pathname.startsWith(p + "/"))
  );
}

export async function updateSession(
  request: NextRequest
): Promise<NextResponse> {
  if (isPublic(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }

  const response = NextResponse.next({ request });

  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }

    return response;
  } catch {
    return response;
  }
}
