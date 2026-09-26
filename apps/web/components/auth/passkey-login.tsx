"use client"
// SPDX-License-Identifier: MIT
/**
 * PasskeyLogin — sign in with a passkey (no password required).
 * On success, stores the bearer token and triggers a page navigation.
 * Mobile: not rendered (WebAuthn unsupported in Flutter WebView).
 * WCAG-AA: aria-label, role, focus-visible ring.
 */

import { useState } from "react"
import {
  startAuthentication,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser"
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server"

interface Props {
  /** Optional — pre-populate the allow list for a specific account. */
  email?: string
  /** Called with bearer token on successful authentication. */
  onSuccess?: (token: string | null, userId: string) => void
  className?: string
}

export function PasskeyLogin({ email, onSuccess, className }: Props) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (!browserSupportsWebAuthn()) {
    return (
      <p className="text-sm text-muted-foreground">
        Use a passkey on a supported browser or device.
      </p>
    )
  }

  async function handleLogin() {
    setState("loading")
    setErrorMsg(null)
    try {
      const optRes = await fetch("/api/auth/passkey/authenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      if (!optRes.ok) throw new Error(await optRes.text())
      const options = (await optRes.json()) as PublicKeyCredentialRequestOptionsJSON

      const assertionResp = await startAuthentication({ optionsJSON: options })

      const verRes = await fetch("/api/auth/passkey/authenticate-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assertionResp),
      })
      if (!verRes.ok) throw new Error(await verRes.text())

      const result = (await verRes.json()) as {
        verified: boolean
        userId: string
        token: string | null
      }

      if (!result.verified) throw new Error("Verification failed")

      setState("done")
      onSuccess?.(result.token, result.userId)
    } catch (err) {
      setState("error")
      setErrorMsg(err instanceof Error ? err.message : "Authentication failed")
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        role="button"
        aria-label="Sign in with passkey"
        aria-busy={state === "loading"}
        disabled={state === "loading" || state === "done"}
        onClick={handleLogin}
        className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium
                   border border-input bg-background shadow-sm
                   hover:bg-accent hover:text-accent-foreground
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                   disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {state === "loading" && (
          <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        )}
        Sign in with passkey
      </button>
      {state === "error" && errorMsg && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {errorMsg}
        </p>
      )}
    </div>
  )
}
