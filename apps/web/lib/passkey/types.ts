// SPDX-License-Identifier: MIT
/**
 * Passkey / WebAuthn domain types (ADR-0016).
 * Stored in the auth schema passkey_credentials table.
 */

export interface PasskeyCredential {
  id: string
  userId: string
  credentialId: string
  publicKey: Uint8Array
  counter: number
  deviceType: string
  backedUp: boolean
  transports: string[]
  createdAt: Date
}

export interface RegistrationOptions {
  challenge: string
  rpName: string
  rpId: string
  userId: string
  userName: string
  userDisplayName: string
}

export interface AuthenticationOptions {
  challenge: string
  rpId: string
  allowCredentials: Array<{
    id: string
    type: "public-key"
    transports?: string[]
  }>
}
