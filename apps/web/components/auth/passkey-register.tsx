"use client"
// SPDX-License-Identifier: MIT
/**
 * PasskeyRegister — lets a logged-in user add a passkey to their account.
 * Browser-only (WebAuthn).  Render conditionally where the browser supports it.
 * WCAG-AA: button has aria-label, focus-visible ring, role=button explicit.
 */

import { useState } from "react"
import {
  startRegistration,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser"
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/server"

interface Props {
  className?: string
}

export function PasskeyRegister({ className }: Props) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (!browserSupportsWebAuthn()) return null

  async function handleRegister() {
    setState("loading")
    setErrorMsg(null)
    try {
      const optRes = await fetch("/api/auth/passkey/register", { method: "POST" })
      if (!optRes.ok) throw new Error(await optRes.text())
      const options = (await optRes.json()) as PublicKeyCredentialCreationOptionsJSON

      const attResp = await startRegistration({ optionsJSON: options })

      const verRes = await fetch("/api/auth/passkey/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attResp),
      })
      if (!verRes.ok) throw new Error(await verRes.text())

      setState("done")
    } catch (err) {
      setState("error")
      setErrorMsg(err instanceof Error ? err.message : "Registration failed")
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        role="button"
        aria-label={
          state === "done" ? "Passkey registered" : "Register a passkey"
        }
        aria-busy={state === "loading"}
        disabled={state === "loading" || state === "done"}
        onClick={handleRegister}
        className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium
                   bg-primary text-primary-foreground shadow-sm
                   hover:bg-primary/90 focus-visible:outline-none
                   focus-visible:ring-2 focus-visible:ring-ring
                   disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {state === "loading" && (
          <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        )}
        {state === "done" ? "Passkey registered" : "Add passkey"}
      </button>
      {state === "error" && errorMsg && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {errorMsg}
        </p>
      )}
      {state === "done" && (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          Passkey added. You can now sign in without a password.
        </p>
      )}
    </div>
  )
}
