// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";
import { signIn, signUp, signInWithGoogle } from "@/lib/auth/client";
import { PasskeyLogin } from "@/components/auth/passkey-login";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { postLoginDestination } from "@/lib/hosts/split";

const GOOGLE_ENABLED = !!(
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true"
);

export default function LoginForm({ appOrigin = "" }: { appOrigin?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // NEXALOG-HOSTSPLIT — `next` arrives from the middleware as an app-RELATIVE
  // path (`/app/notes`), which the reader must reach on the APP host, not on the
  // marketing host that served this form. It is sanitized on the way in
  // (`//evil.com`, a scheme, a backslash and control characters all collapse to
  // the default) and then resolved against `appOrigin`, which the SERVER passes
  // in — so the destination's origin is decided server-side and never by the
  // query string. With no split configured `appOrigin` is `""` and this is the
  // same relative path the form pushed before.
  const next = postLoginDestination(appOrigin, searchParams.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (isSignUp) {
        const result = await signUp(email, password, name || email);
        if (result.error) {
          setError(result.error.message ?? "Sign up failed");
          return;
        }
      } else {
        const result = await signIn(email, password);
        if (result.error) {
          setError(result.error.message ?? "Sign in failed");
          return;
        }
      }
      // Already absolute when the split is configured (the server supplied the
      // app origin), so this is a cross-host navigation onto app.nexalog.com.
      router.push(next);
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    setError("");
    try {
      await signInWithGoogle();
    } catch {
      setError("Google sign-in failed");
      setGoogleLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center">
            <Link href="/" className="font-heading text-2xl font-bold text-foreground">
              <span className="text-copper">_</span>nexalog
            </Link>
          </div>
          <h1 className="text-lg font-medium tracking-tight text-foreground">
            {isSignUp ? "Create your account" : "Sign in to Nexalog"}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {isSignUp ? "A few details and you're in." : "Your account"}
          </p>
        </div>

        <div className="rounded-md border border-border bg-card p-6">
          {GOOGLE_ENABLED && (
            <>
              <button
                type="button"
                onClick={handleGoogle}
                disabled={googleLoading || loading}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                {googleLoading ? (
                  "Redirecting..."
                ) : (
                  <>
                    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                    Continue with Google
                  </>
                )}
              </button>

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            {isSignUp && (
              <div>
                <label htmlFor="login-name" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Name
                </label>
                <input
                  id="login-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  className="w-full rounded-md border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-copper/30 focus:outline-none focus:ring-1 focus:ring-copper/20"
                />
              </div>
            )}
            <div>
              <label htmlFor="login-email" className="mb-1 block text-xs font-medium text-muted-foreground">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full rounded-md border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-copper/30 focus:outline-none focus:ring-1 focus:ring-copper/20"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="login-password" className="block text-xs font-medium text-muted-foreground">
                  Password
                </label>
              </div>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={isSignUp ? "new-password" : "current-password"}
                placeholder="••••••••••••"
                className="w-full rounded-md border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-copper/30 focus:outline-none focus:ring-1 focus:ring-copper/20"
              />
            </div>

            {error && (
              <div
                className="rounded-md border border-border px-3 py-2 text-xs text-foreground"
                role="alert"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="flex w-full items-center justify-center rounded-md bg-copper px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Signing in…" : isSignUp ? "Create Account" : "Sign In"}
            </button>
          </form>

          {!isSignUp && (
            <div className="mt-4 space-y-3">
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>
              <PasskeyLogin
                className="w-full [&_button]:w-full [&_button]:justify-center"
                onSuccess={() => router.push(next)}
              />
            </div>
          )}
        </div>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError("");
            }}
            className="font-medium text-foreground hover:underline"
          >
            {isSignUp ? "Sign in" : "Create one"}
          </button>
        </p>

        <p className="mt-3 text-center text-xs text-muted-foreground">
          By continuing, you agree to our{" "}
          <Link href="/terms" className="underline hover:text-foreground">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
