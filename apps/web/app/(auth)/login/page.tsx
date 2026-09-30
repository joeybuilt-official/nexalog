// SPDX-License-Identifier: MIT
import { Suspense } from "react";
import { redirect } from "next/navigation";
import LoginForm from "./login-form";
import { getAuthUser } from "@/lib/auth/server";
import { hostConfig } from "@/lib/hosts/config";
import { appDestination, DEFAULT_APP_PATH } from "@/lib/hosts/split";

/**
 * NEXALOG-HOSTSPLIT — the login page is served by the FRONT host (nexalog.com),
 * and a reader who arrives here WITH a session is sent straight into the app on
 * the APP host instead of being shown a sign-in form they do not need.
 *
 * The redirect lives here rather than in `middleware.ts` on purpose: this is the
 * first layer that can VERIFY a session rather than merely observe a session
 * cookie. A rule keyed on a cookie alone turns an expired session into a
 * redirect loop (login → app → the app layout's real session check → login …),
 * and a stale cookie is exactly the state a reader returns in with.
 */
export default async function LoginPage() {
  const origins = hostConfig();

  if (await getAuthUser()) redirect(appDestination(origins, DEFAULT_APP_PATH));

  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center" />}>
      {/* The app origin is passed DOWN from the server rather than read in the
          browser: the form is a client component, and `process.env` there is
          frozen at BUILD time. This is what makes the post-login destination the
          app host even though the form itself is served by the front host. */}
      <LoginForm appOrigin={origins.app} />
    </Suspense>
  );
}
