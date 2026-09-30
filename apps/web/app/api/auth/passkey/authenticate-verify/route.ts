// SPDX-License-Identifier: MIT
/**
 * POST /api/auth/passkey/authenticate-verify
 * Verifies the authenticator assertion and returns user info on success.
 * The client then calls better-auth signIn.bearer({ token }) to establish
 * a session.  The token is the Nexalog user id — we issue a bearer token
 * from better-auth and return it.
 */

import { NextResponse } from "next/server"
import {
  verifyAuthenticationResponse,
  type VerifyAuthenticationResponseOpts,
} from "@simplewebauthn/server"
import type { AuthenticationResponseJSON } from "@simplewebauthn/server"
import { PasskeyStore } from "@/lib/passkey/store"
import { ChallengeStore } from "@/lib/passkey/challenge-store"
import { recognizeCredential } from "@/lib/identity/recognition"
import { passkeyOrigins } from "@/lib/hosts/config"

const RP_ID = process.env.NEXT_PUBLIC_RP_ID ?? "localhost"
// NEXALOG-HOSTSPLIT — see the register-verify route: accept every configured
// origin so a passkey login taken on the front host still verifies.
const ORIGIN = passkeyOrigins()

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AuthenticationResponseJSON

    const credential = await PasskeyStore.getByCredentialId(body.id)
    if (!credential) {
      return NextResponse.json({ error: "Credential not found" }, { status: 400 })
    }

    const expectedChallenge = ChallengeStore.get(`auth:${body.response.clientDataJSON}`) ??
      // Fall back: the challenge was stored by the value; re-decode it.
      (() => {
        try {
          const parsed = JSON.parse(
            Buffer.from(body.response.clientDataJSON, "base64url").toString(),
          ) as { challenge?: string }
          return parsed.challenge
            ? ChallengeStore.get(`auth:${parsed.challenge}`)
            : null
        } catch {
          return null
        }
      })()

    if (!expectedChallenge) {
      return NextResponse.json(
        { error: "Challenge expired or not found" },
        { status: 400 },
      )
    }

    const opts: VerifyAuthenticationResponseOpts = {
      response: body,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: credential.credentialId,
        publicKey: Buffer.from(credential.publicKey) as unknown as Uint8Array<ArrayBuffer>,
        counter: credential.counter,
        transports: credential.transports as AuthenticatorTransport[],
      },
      requireUserVerification: false,
    }

    const { verified, authenticationInfo } =
      await verifyAuthenticationResponse(opts)

    // Clean up challenge regardless of outcome
    try {
      const parsed = JSON.parse(
        Buffer.from(body.response.clientDataJSON, "base64url").toString(),
      ) as { challenge?: string }
      if (parsed.challenge) ChallengeStore.delete(`auth:${parsed.challenge}`)
    } catch {
      // ignore
    }

    if (!verified) {
      return NextResponse.json({ error: "Verification failed" }, { status: 400 })
    }

    await PasskeyStore.updateCounter(
      credential.credentialId,
      authenticationInfo.newCounter,
    )

    // Recognition, not linking (ADR-0016 B2): the credential resolves to the
    // existing shared identity — same passkey in a sibling app = same user.
    const identity = await recognizeCredential(credential.credentialId)
    if (!identity) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    return NextResponse.json({
      verified: true,
      userId: identity.userId,
      email: identity.email,
      name: identity.name,
    })
  } catch (err) {
    console.error("[passkey/authenticate-verify]", err)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
