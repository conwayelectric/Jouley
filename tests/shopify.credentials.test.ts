import { describe, it, expect } from "vitest";
import { validateShopifyCredentials } from "../server/shopify";

describe("Shopify credentials", () => {
  it("can exchange client credentials for an access token", async () => {
    const valid = await validateShopifyCredentials();
    expect(valid).toBe(true);
  }, 15000); // 15s timeout for network call
});
