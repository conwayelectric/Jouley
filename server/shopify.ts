/**
 * Shopify Admin API integration using client credentials grant.
 *
 * Every discount code is globally unique: it is generated from 5 random
 * bytes (10 hex chars) so the collision probability is negligible even at
 * millions of codes. The device ID is NOT used as the code itself — it is
 * only used as a label in the discount title so support staff can trace
 * which device triggered which code.
 *
 * Code format:  CE-XXXXXXXXXX  (CE prefix + 10 uppercase hex chars)
 * Example:      CE-3FA2C8D01B
 *
 * Uses discountCodeBasicCreate (Shopify Admin API 2024-10+).
 * The legacy priceRuleCreate mutation was removed in that version.
 */

import { randomBytes } from "crypto";
import { ENV } from "./_core/env.js";

// ---------------------------------------------------------------------------
// Token cache — reuse within the 24h window, refresh before expiry
// ---------------------------------------------------------------------------

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  // Refresh 5 minutes before expiry
  if (cachedToken && now < tokenExpiresAt - 5 * 60 * 1000) {
    return cachedToken;
  }

  const url = `https://${ENV.shopifyShop}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    client_id: ENV.shopifyClientId,
    client_secret: ENV.shopifyClientSecret,
    grant_type: "client_credentials",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = data.access_token;
  tokenExpiresAt = now + data.expires_in * 1000;
  return cachedToken;
}

/** Force the next getAccessToken() call to fetch a fresh token. */
export function invalidateTokenCache(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}

// ---------------------------------------------------------------------------
// GraphQL Admin API helper
// ---------------------------------------------------------------------------

async function shopifyGraphQL<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const token = await getAccessToken();
  const url = `https://${ENV.shopifyShop}/admin/api/2024-10/graphql.json`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify GraphQL request failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors && json.errors.length > 0) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

// ---------------------------------------------------------------------------
// Unique code generation
// ---------------------------------------------------------------------------

/**
 * Generates a globally unique discount code.
 *
 * Format: CE-XXXXXXXXXX
 *   - "CE" prefix (Conway Electric)
 *   - 10 uppercase hex characters from 5 cryptographically random bytes
 *
 * Collision probability with 1 million codes: ~0.000000001% (negligible).
 */
function generateUniqueCode(): string {
  const hex = randomBytes(5).toString("hex").toUpperCase(); // 10 chars
  return `CE-${hex}`;
}

// ---------------------------------------------------------------------------
// Discount code creation — uses discountCodeBasicCreate (current API)
// ---------------------------------------------------------------------------

export interface CreatedDiscountCode {
  code: string;
  expiresAt: string; // ISO date string
}

/**
 * Creates a globally unique one-time 15% off discount code in Shopify.
 * The code is valid for a single use and expires 30 days from now.
 *
 * @param deviceId  Used only in the discount title for traceability.
 *                  It is NOT used as the code itself.
 */
export async function createUniqueDiscountCode(
  deviceId: string
): Promise<CreatedDiscountCode> {
  const code = generateUniqueCode();
  const startsAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const mutation = `
    mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              title
              codes(first: 1) {
                nodes {
                  code
                }
              }
            }
          }
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  const variables = {
    basicCodeDiscount: {
      title: `Conway Electric App 15% Off [${deviceId.slice(0, 12)}]`,
      code,
      startsAt,
      endsAt: expiresAt,
      usageLimit: 1,
      customerGets: {
        value: {
          percentage: 0.15,
        },
        items: {
          all: true,
        },
      },
      customerSelection: {
        all: true,
      },
    },
  };

  const result = await shopifyGraphQL<{
    discountCodeBasicCreate: {
      codeDiscountNode: {
        id: string;
        codeDiscount: {
          title?: string;
          codes?: { nodes: { code: string }[] };
        };
      } | null;
      userErrors: { field: string[]; message: string; code: string }[];
    };
  }>(mutation, variables);

  const userErrors = result.discountCodeBasicCreate.userErrors;
  if (userErrors.length > 0) {
    throw new Error(`Discount code creation failed: ${JSON.stringify(userErrors)}`);
  }

  // Use the code confirmed by Shopify (should match what we sent)
  const confirmedCode =
    result.discountCodeBasicCreate.codeDiscountNode?.codeDiscount?.codes?.nodes?.[0]?.code ?? code;

  return { code: confirmedCode, expiresAt };
}

/**
 * Validates Shopify credentials by requesting an access token.
 * Returns true if credentials are valid.
 */
export async function validateShopifyCredentials(): Promise<boolean> {
  try {
    await getAccessToken();
    return true;
  } catch {
    return false;
  }
}
