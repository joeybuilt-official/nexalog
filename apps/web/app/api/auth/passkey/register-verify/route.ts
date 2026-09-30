// SPDX-License-Identifier: MIT
/**
 * POST /api/auth/passkey/register-verify
 * Verifies the authenticator response and persists the credential.
 */

import { NextResponse } from "next/server"
import {
  verifyRegistrationResponse,
  type VerifyRegistrationResponseOpts,
} from "@simplewebauthn/server"
import type { RegistrationResponseJSON } from "@simplewebauthn/server"
import { PasskeyStore } from "@/lib/passkey/store"
import { ChallengeStore } from "@/lib/passkey/challenge-store"
import { RecoveryCodes } from "@/lib/identity/recovery-codes"
import { auth } from "@/lib/auth"
import { passkeyOrigins } from "@/lib/hosts/config"
import { headers } from "next/headers"

const RP_ID = process.env.NEXT_PUBLIC_RP_ID ?? "localhost"
// NEXALOG-HOSTSPLIT — the ceremony may have occurred on EITHER host once the
// front-end split is configured (the RP ID is the registrable domain, which
// already covers both), so verification accepts every configured origin.
// Single-host deployments get the same one-element list this route had before.
const ORIGIN = passkeyOrigins()

export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = session.user.id
    const expectedChallenge = ChallengeStore.get(`reg:${userId}`)
    if (!expectedChallenge) {
      return NextResponse.json(
        { error: "Challenge expired or not found" },
        { status: 400 },
      )
    }

    const body = (await req.json()) as RegistrationResponseJSON
    const opts: VerifyRegistrationResponseOpts = {
      response: body,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    }

    const { verified, registrationInfo } = await verifyRegistrationResponse(opts)
    ChallengeStore.delete(`reg:${userId}`)

    if (!verified || !registrationInfo) {
      return NextResponse.json({ error: "Verification failed" }, { status: 400 })
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      registrationInfo

    await PasskeyStore.create({
      userId,
      credentialId: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: (body.response.transports ?? []) as string[],
    })

    // ADR-0016 B4 fallback 1: first anchor registration also mints the user's
    // recovery codes (returned once, hashed at rest).
    const recoveryCodes = await RecoveryCodes.ensure(userId)

    return NextResponse.json({ verified: true, recoveryCodes })
  } catch (err) {
    console.error("[passkey/register-verify]", err)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
