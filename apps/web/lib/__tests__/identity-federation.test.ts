// SPDX-License-Identifier: MIT
// U11: recognition-not-linking (B2) + Plexo coordinator-not-root (B3), ADR-0016
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/passkey/store", () => ({
  PasskeyStore: {
    getByCredentialId: vi.fn(),
    getUserById: vi.fn(),
  },
}))

import { PasskeyStore } from "@/lib/passkey/store"

describe("recognizeCredential (B2 — recognition, not linking)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("resolves an existing shared identity — no account creation path exists", async () => {
    vi.mocked(PasskeyStore.getByCredentialId).mockResolvedValue({
      id: "1",
      userId: "u1",
      credentialId: "cred1",
      publicKey: new Uint8Array(),
      counter: 0,
      deviceType: "platform",
      backedUp: true,
      transports: [],
      createdAt: new Date(0),
    })
    vi.mocked(PasskeyStore.getUserById).mockResolvedValue({
      id: "u1",
      email: "a@b.c",
      name: "Ada",
    })
    const { recognizeCredential } = await import("@/lib/identity/recognition")
    expect(await recognizeCredential("cred1")).toEqual({
      userId: "u1",
      email: "a@b.c",
      name: "Ada",
    })
  })

  it("unknown credential -> null (never mints)", async () => {
    vi.mocked(PasskeyStore.getByCredentialId).mockResolvedValue(null)
    const { recognizeCredential } = await import("@/lib/identity/recognition")
    expect(await recognizeCredential("nope")).toBeNull()
  })

  it("coordinator failure never blocks recognition (Plexo not a dependency)", async () => {
    vi.stubEnv("PLEXO_URL", "http://plexo.test")
    vi.stubEnv("PLEXO_SERVICE_KEY", "sk")
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("plexo down")))
    vi.mocked(PasskeyStore.getByCredentialId).mockResolvedValue({
      id: "1",
      userId: "u1",
      credentialId: "cred1",
      publicKey: new Uint8Array(),
      counter: 0,
      deviceType: "platform",
      backedUp: true,
      transports: [],
      createdAt: new Date(0),
    })
    vi.mocked(PasskeyStore.getUserById).mockResolvedValue({
      id: "u1",
      email: "a@b.c",
      name: "Ada",
    })
    const { recognizeCredential } = await import("@/lib/identity/recognition")
    expect((await recognizeCredential("cred1"))?.userId).toBe("u1")
  })
})

describe("IdentityCoordinator resolution (B3 — coordinator, never root)", () => {
  beforeEach(() => vi.unstubAllEnvs())
  afterEach(() => vi.unstubAllGlobals())

  it("no Plexo env -> NullCoordinator (app standalone)", async () => {
    const { resolveCoordinator, NullCoordinator } = await import("@/lib/identity/coordinator")
    expect(resolveCoordinator()).toBe(NullCoordinator)
    expect(await NullCoordinator.getCanonicalProfile("u1")).toBeNull()
  })

  it("Plexo env -> PlexoCoordinator posts recognition to the Jex endpoint", async () => {
    vi.stubEnv("PLEXO_URL", "http://plexo.test")
    vi.stubEnv("PLEXO_SERVICE_KEY", "sk")
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal("fetch", fetchMock)
    const { resolveCoordinator } = await import("@/lib/identity/coordinator")
    await resolveCoordinator().recordRecognition({
      userId: "u1",
      email: "a@b.c",
      credentialId: "cred1",
    })
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://plexo.test/api/jex/identity/recognition")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      appId: "nexalog",
      userId: "u1",
      credentialId: "cred1",
    })
  })

  it("profile fetch failure -> null, never throws", async () => {
    vi.stubEnv("PLEXO_URL", "http://plexo.test")
    vi.stubEnv("PLEXO_SERVICE_KEY", "sk")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }))
    const { resolveCoordinator } = await import("@/lib/identity/coordinator")
    expect(await resolveCoordinator().getCanonicalProfile("u1")).toBeNull()
  })
})
