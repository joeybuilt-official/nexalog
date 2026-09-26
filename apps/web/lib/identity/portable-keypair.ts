// SPDX-License-Identifier: MIT
/**
 * Portable generated-keypair anchor (ADR-0016 B4 fallback 2).
 *
 * For passkey-hostile browsers / headless self-host: the server generates an
 * Ed25519 keypair, stores the PUBLIC key as a credential row
 * (device_type = 'portable-keypair', same auth.passkey_credentials table),
 * and hands the PRIVATE key PEM to the user exactly once. Authentication is
 * challenge–response: sign the server challenge with the private key; the
 * verified credential flows through the same recognition path as a passkey
 * (recognition, not linking — same anchor semantics).
 */

import { createPublicKey, generateKeyPairSync, randomBytes, verify as edVerify } from "node:crypto"
import { PasskeyStore } from "@/lib/passkey/store"

export const PORTABLE_DEVICE_TYPE = "portable-keypair"

export interface GeneratedAnchor {
  credentialId: string
  /** PKCS8 PEM — shown once, never stored server-side. */
  privateKeyPem: string
}

export const PortableKeypair = {
  /** Generate an Ed25519 anchor for `userId`; store only the public key. */
  async generate(userId: string): Promise<GeneratedAnchor> {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const credentialId = `pk_${randomBytes(16).toString("base64url")}`
    await PasskeyStore.create({
      userId,
      credentialId,
      publicKey: new Uint8Array(publicKey.export({ format: "der", type: "spki" })),
      counter: 0,
      deviceType: PORTABLE_DEVICE_TYPE,
      backedUp: true,
      transports: [],
    })
    return {
      credentialId,
      privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    }
  },

  /** Verify `signature` (base64) over `challenge` (utf8) with the stored public key. */
  async verify(credentialId: string, challenge: string, signatureB64: string): Promise<boolean> {
    const cred = await PasskeyStore.getByCredentialId(credentialId)
    if (!cred || cred.deviceType !== PORTABLE_DEVICE_TYPE) return false
    try {
      const key = createPublicKey({
        key: Buffer.from(cred.publicKey),
        format: "der",
        type: "spki",
      })
      return edVerify(null, Buffer.from(challenge), key, Buffer.from(signatureB64, "base64"))
    } catch {
      return false
    }
  },
}
