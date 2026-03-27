/**
 * Shopify Admin API integration using client credentials grant.
 * Exchanges Client ID + Secret for a short-lived access token (24h),
 * then uses it to create unique one-time discount codes.
 */

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
// Discount code creation
// ---------------------------------------------------------------------------

export interface CreatedDiscountCode {
  code: string;
  expiresAt: string; // ISO date string
}

/**
 * Creates a unique one-time 15% off discount code in Shopify.
 * The code is valid for a single use and expires 30 days from now.
 */
export async function createUniqueDiscountCode(
  deviceId: string
): Promise<CreatedDiscountCode> {
  // Generate a short, readable code: CE-XXXXXXXX (CE = Conway Electric)
  const suffix = deviceId
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8)
    .padEnd(8, "X");
  const code = `CE-${suffix}`;

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // Step 1: Create a price rule for 15% off
  const priceRuleMutation = `
    mutation priceRuleCreate($input: PriceRuleInput!) {
      priceRuleCreate(input: $input) {
        priceRule {
          id
        }
        priceRuleUserErrors {
          field
          message
        }
      }
    }
  `;

  const priceRuleVars = {
    input: {
      title: `Conway Electric App 15% Off - ${code}`,
      target: "LINE_ITEM",
      value: {
        percentageValue: -15,
      },
      customerSelection: {
        forAllCustomers: true,
      },
      itemEntitlements: {
        targetAllLineItems: true,
      },
      usageLimit: 1,
      oncePerCustomer: true,
      startsAt: new Date().toISOString(),
      endsAt: expiresAt,
    },
  };

  const priceRuleResult = await shopifyGraphQL<{
    priceRuleCreate: {
      priceRule: { id: string } | null;
      priceRuleUserErrors: { field: string[]; message: string }[];
    };
  }>(priceRuleMutation, priceRuleVars);

  const priceRuleErrors = priceRuleResult.priceRuleCreate.priceRuleUserErrors;
  if (priceRuleErrors.length > 0) {
    throw new Error(`Price rule creation failed: ${JSON.stringify(priceRuleErrors)}`);
  }

  const priceRuleId = priceRuleResult.priceRuleCreate.priceRule?.id;
  if (!priceRuleId) {
    throw new Error("Price rule creation returned no ID");
  }

  // Step 2: Create the discount code under that price rule
  const discountCodeMutation = `
    mutation discountCodeCreate($priceRuleId: ID!, $code: String!) {
      priceRuleDiscountCodeCreate(priceRuleId: $priceRuleId, code: $code) {
        priceRuleDiscountCode {
          code
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const discountCodeResult = await shopifyGraphQL<{
    priceRuleDiscountCodeCreate: {
      priceRuleDiscountCode: { code: string } | null;
      userErrors: { field: string[]; message: string }[];
    };
  }>(discountCodeMutation, { priceRuleId, code });

  const discountErrors =
    discountCodeResult.priceRuleDiscountCodeCreate.userErrors;
  if (discountErrors.length > 0) {
    throw new Error(`Discount code creation failed: ${JSON.stringify(discountErrors)}`);
  }

  return { code, expiresAt };
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
