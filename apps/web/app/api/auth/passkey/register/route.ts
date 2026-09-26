// SPDX-License-Identifier: MIT
/**
 * POST /api/auth/passkey/register
 * Generates registration options for a logged-in user.
 * Body: { email: string }
 */

import { NextResponse } from "next/server"
import {
  generateRegistrationOptions,
  type GenerateRegistrationOptionsOpts,
} from "@simplewebauthn/server"
import { PasskeyStore } from "@/lib/passkey/store"
import { ChallengeStore } from "@/lib/passkey/challenge-store"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"

const RP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Nexalog"
const RP_ID = process.env.NEXT_PUBLIC_RP_ID ?? "localhost"

export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = session.user.id
    const userName = session.user.email ?? session.user.name ?? userId
    const userDisplayName = session.user.name ?? userName

    const existingCredentials = await PasskeyStore.getByUserId(userId)

    const opts: GenerateRegistrationOptionsOpts = {
      rpName: RP_NAME,
      rpID: RP_ID,
      userName,
      userDisplayName,
      attestationType: "none",
      excludeCredentials: existingCredentials.map((c) => ({
        id: c.credentialId,
        transports: c.transports as AuthenticatorTransport[],
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    }

    const options = await generateRegistrationOptions(opts)
    ChallengeStore.set(`reg:${userId}`, options.challenge)

    return NextResponse.json(options)
  } catch (err) {
    console.error("[passkey/register]", err)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
