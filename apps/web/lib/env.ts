// SPDX-License-Identifier: MIT

/**
 * Cloud-only features (Stripe billing, super-admin coupon management)
 * are disabled by default for self-hosters. Set BILLING_ENABLED=true
 * to opt back in. See README "Self-Hosting Notes".
 */
export function isBillingEnabled(): boolean {
  return process.env.BILLING_ENABLED === "true";
}
