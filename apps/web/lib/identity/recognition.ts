// SPDX-License-Identifier: MIT
/**
 * Recognition, not account-linking (ADR-0016 B2).
 *
 * A passkey credential in the shared auth schema IS the identity anchor. When
 * a verified assertion arrives — whether the credential was registered by
 * nexalog or by any sibling app against the same auth schema — we RECOGNIZE
 * the existing identity: resolve the credential's user and hand it back.
 * No new account is minted, no linking row is written, no session migrates.
 */

import { PasskeyStore } from "@/lib/passkey/store"
import { resolveCoordinator } from "./coordinator"

export interface RecognizedIdentity {
  userId: string
  email: string
  name: string
}

export async function recognizeCredential(
  credentialId: string,
): Promise<RecognizedIdentity | null> {
  const credential = await PasskeyStore.getByCredentialId(credentialId)
  if (!credential) return null
  const user = await PasskeyStore.getUserById(credential.userId)
  if (!user) return null

  // Coordinator enrichment (B3): fire-and-forget; app never waits on Plexo.
  void resolveCoordinator().recordRecognition({
    userId: user.id,
    email: user.email,
    credentialId,
  })

  return { userId: user.id, email: user.email, name: user.name }
}
