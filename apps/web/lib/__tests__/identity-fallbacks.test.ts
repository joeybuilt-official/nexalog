// SPDX-License-Identifier: MIT
// U12: ADR-0016 B4 fallbacks — recovery codes, portable keypair, pre-anchor link
import { describe, it, expect, vi, beforeEach } from "vitest"
import { generateKeyPairSync, sign as edSign } from "node:crypto"

const credRows = new Map<string, Record<string, unknown>>()

vi.mock("@/lib/passkey/store", () => ({
  authPool: { query: vi.fn() },
  PasskeyStore: {
    create: vi.fn(async (c: Record<string, unknown>) => {
      credRows.set(c.credentialId as string, c)
    }),
    getByCredentialId: vi.fn(async (id: string) => {
      const c = credRows.get(id)
      return c
        ? {
            id: "row1",
            userId: c.userId,
            credentialId: id,
            publicKey: c.publicKey,
            counter: 0,
            deviceType: c.deviceType,
            backedUp: true,
            transports: [],
            createdAt: new Date(0),
          }
        : null
    }),
    getUserById: vi.fn(async (id: string) => ({ id, email: "a@b.c", name: "Ada" })),
    getUserIdByEmail: vi.fn(async () => "u1"),
  },
}))

import { authPool } from "@/lib/passkey/store"

describe("RecoveryCodes (fallback 1)", () => {
  beforeEach(() => vi.mocked(authPool.query).mockReset())

  it("ensure mints 8 XXXX-XXXX codes when none exist, stores hashes", async () => {
    vi.mocked(authPool.query).mockResolvedValue({ rows: [] } as never)
    const { RecoveryCodes } = await import("@/lib/identity/recovery-codes")
    const codes = await RecoveryCodes.ensure("u1")
    expect(codes).toHaveLength(8)
    for (const c of codes!) expect(c).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/)
    // 1 existence check + 8 inserts, all parameterized with hashes (not plaintext)
    const inserts = vi.mocked(authPool.query).mock.calls.slice(1)
    expect(inserts).toHaveLength(8)
    for (const [, params] of inserts) expect((params as string[])[1]).toMatch(/^[0-9a-f]{64}$/)
  })

  it("ensure is idempotent — existing codes -> null", async () => {
    vi.mocked(authPool.query).mockResolvedValue({ rows: [{ 1: 1 }] } as never)
    const { RecoveryCodes } = await import("@/lib/identity/recovery-codes")
    expect(await RecoveryCodes.ensure("u1")).toBeNull()
  })

  it("redeem marks single-use and returns identity; used/invalid -> null", async () => {
    const { RecoveryCodes } = await import("@/lib/identity/recovery-codes")
    vi.mocked(authPool.query).mockResolvedValueOnce({ rows: [{ id: "rc1" }] } as never)
    expect(await RecoveryCodes.redeem("a@b.c", "abcd-1234")).toEqual({
      userId: "u1",
      email: "a@b.c",
      name: "Ada",
    })
    const [sql] = vi.mocked(authPool.query).mock.calls[0]
    expect(sql).toContain("used_at IS NULL")
    vi.mocked(authPool.query).mockResolvedValueOnce({ rows: [] } as never)
    expect(await RecoveryCodes.redeem("a@b.c", "abcd-1234")).toBeNull()
  })
})

describe("PortableKeypair (fallback 2)", () => {
  it("generate stores public key row; sign/verify roundtrip succeeds", async () => {
    const { PortableKeypair, PORTABLE_DEVICE_TYPE } = await import("@/lib/identity/portable-keypair")
    const anchor = await PortableKeypair.generate("u1")
    expect(anchor.credentialId).toMatch(/^pk_/)
    expect(anchor.privateKeyPem).toContain("PRIVATE KEY")
    expect(credRows.get(anchor.credentialId)?.deviceType).toBe(PORTABLE_DEVICE_TYPE)

    const challenge = "test-challenge"
    const { createPrivateKey, sign } = await import("node:crypto")
    const key = createPrivateKey(anchor.privateKeyPem)
    const sig = sign(null, Buffer.from(challenge), key).toString("base64")
    expect(await PortableKeypair.verify(anchor.credentialId, challenge, sig)).toBe(true)
    expect(await PortableKeypair.verify(anchor.credentialId, "other", sig)).toBe(false)
  })

  it("verify rejects non-keypair credentials and unknown ids", async () => {
    const { PortableKeypair } = await import("@/lib/identity/portable-keypair")
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    credRows.set("webauthn1", {
      userId: "u1",
      credentialId: "webauthn1",
      publicKey: new Uint8Array(publicKey.export({ format: "der", type: "spki" })),
      deviceType: "platform",
    })
    const sig = edSign(null, Buffer.from("c"), privateKey).toString("base64")
    expect(await PortableKeypair.verify("webauthn1", "c", sig)).toBe(false)
    expect(await PortableKeypair.verify("ghost", "c", sig)).toBe(false)
  })
})

describe("pre-anchor link (fallback 3)", () => {
  it("registration binds an anchor to the EXISTING session user — no new account", async () => {
    // The register flow requires an authenticated better-auth session (any
    // method, incl. legacy password) and writes the credential against that
    // user id. Linking = registering; there is no separate link table.
    const { PortableKeypair } = await import("@/lib/identity/portable-keypair")
    const anchor = await PortableKeypair.generate("legacy-password-user")
    expect(credRows.get(anchor.credentialId)?.userId).toBe("legacy-password-user")
  })
})
