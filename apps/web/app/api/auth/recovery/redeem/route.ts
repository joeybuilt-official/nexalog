// SPDX-License-Identifier: MIT
/**
 * POST /api/auth/recovery/redeem  { email, code }
 * ADR-0016 B4 fallback 1: redeem a single-use recovery code when the passkey
 * device is lost. Returns the same shape as passkey authenticate-verify; the
 * client establishes a session the same way.
 */

import { NextResponse } from "next/server"
import { RecoveryCodes } from "@/lib/identity/recovery-codes"

export async function POST(req: Request) {
  try {
    const { email, code } = (await req.json()) as { email?: string; code?: string }
    if (!email || !code) {
      return NextResponse.json({ error: "email and code required" }, { status: 400 })
    }
    const identity = await RecoveryCodes.redeem(email, code)
    if (!identity) {
      return NextResponse.json({ error: "Invalid or used code" }, { status: 400 })
    }
    return NextResponse.json({ verified: true, ...identity })
  } catch (err) {
    console.error("[recovery/redeem]", err)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
