// SPDX-License-Identifier: MIT
/**
 * POST /api/auth/passkey/authenticate
 * Generates authentication options.
 * Body: { email?: string }  (optional — empty allows resident-key discovery)
 */

import { NextResponse } from "next/server"
import {
  generateAuthenticationOptions,
  type GenerateAuthenticationOptionsOpts,
} from "@simplewebauthn/server"
import { PasskeyStore } from "@/lib/passkey/store"
import { ChallengeStore } from "@/lib/passkey/challenge-store"
import { randomBytes } from "node:crypto"

const RP_ID = process.env.NEXT_PUBLIC_RP_ID ?? "localhost"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { email?: string }
    const { email } = body

    const allowCredentials: GenerateAuthenticationOptionsOpts["allowCredentials"] = []
    if (email) {
      const userId = await PasskeyStore.getUserIdByEmail(email)
      if (userId) {
        const creds = await PasskeyStore.getByUserId(userId)
        allowCredentials.push(
          ...creds.map((c) => ({
            id: c.credentialId,
            transports: c.transports as AuthenticatorTransport[],
          })),
        )
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials,
      userVerification: "preferred",
    })

    // Key by challenge so we can verify without knowing the userId yet.
    ChallengeStore.set(`auth:${options.challenge}`, options.challenge)

    return NextResponse.json(options)
  } catch (err) {
    console.error("[passkey/authenticate]", err)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
