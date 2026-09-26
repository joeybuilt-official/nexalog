// SPDX-License-Identifier: MIT
/**
 * Portable-keypair anchor routes (ADR-0016 B4 fallback 2).
 *
 * POST /api/auth/keypair            (session required) → generate anchor,
 *   returns { credentialId, privateKeyPem } — private key shown ONCE.
 * GET  /api/auth/keypair            → { challenge } for challenge–response.
 * PUT  /api/auth/keypair            { credentialId, challenge, signature } →
 *   verifies the Ed25519 signature and recognizes the identity (same
 *   recognition-not-linking path as passkeys).
 */

import { NextResponse } from "next/server"
import { randomBytes } from "node:crypto"
import { PortableKeypair } from "@/lib/identity/portable-keypair"
import { recognizeCredential } from "@/lib/identity/recognition"
import { ChallengeStore } from "@/lib/passkey/challenge-store"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"

export async function POST() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const anchor = await PortableKeypair.generate(session.user.id)
    return NextResponse.json(anchor)
  } catch (err) {
    console.error("[keypair POST]", err)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}

export async function GET() {
  const challenge = randomBytes(32).toString("base64url")
  ChallengeStore.set(`keypair:${challenge}`, challenge)
  return NextResponse.json({ challenge })
}

export async function PUT(req: Request) {
  try {
    const { credentialId, challenge, signature } = (await req.json()) as {
      credentialId?: string
      challenge?: string
      signature?: string
    }
    if (!credentialId || !challenge || !signature) {
      return NextResponse.json({ error: "credentialId, challenge, signature required" }, { status: 400 })
    }
    if (!ChallengeStore.get(`keypair:${challenge}`)) {
      return NextResponse.json({ error: "Challenge expired or not found" }, { status: 400 })
    }
    ChallengeStore.delete(`keypair:${challenge}`)
    if (!(await PortableKeypair.verify(credentialId, challenge, signature))) {
      return NextResponse.json({ error: "Verification failed" }, { status: 400 })
    }
    const identity = await recognizeCredential(credentialId)
    if (!identity) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }
    return NextResponse.json({ verified: true, ...identity })
  } catch (err) {
    console.error("[keypair PUT]", err)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
