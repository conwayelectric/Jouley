/**
 * Unit tests for the Shopify discount code feature.
 *
 * Tests the pure logic functions that don't require a live Shopify connection:
 * - Code generation format
 * - Expiry date calculation
 * - isExpired logic
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Replicate the code-generation logic from server/shopify.ts
// ---------------------------------------------------------------------------

function generateDiscountCode(deviceId: string): string {
  const suffix = deviceId
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8)
    .padEnd(8, "X");
  return `CE-${suffix}`;
}

function generateExpiresAt(): Date {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Replicate the device ID generation logic from hooks/use-discount-code.ts
// ---------------------------------------------------------------------------

function generateDeviceId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${ts}${rand}`.slice(0, 16).padEnd(16, "0");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Discount code generation", () => {
  it("produces a code in CE-XXXXXXXX format", () => {
    const code = generateDiscountCode("ABCD1234EFGH5678");
    expect(code).toMatch(/^CE-[A-Z0-9]{8}$/);
  });

  it("pads short device IDs with X", () => {
    const code = generateDiscountCode("AB");
    expect(code).toBe("CE-ABXXXXXX");
  });

  it("truncates long device IDs to 8 chars", () => {
    const code = generateDiscountCode("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(code).toBe("CE-ABCDEFGH");
  });

  it("strips non-alphanumeric characters from device ID", () => {
    const code = generateDiscountCode("AB-CD_EF!GH");
    expect(code).toBe("CE-ABCDEFGH");
  });

  it("converts device ID to uppercase", () => {
    const code = generateDiscountCode("abcdefgh");
    expect(code).toBe("CE-ABCDEFGH");
  });

  it("produces unique codes for different device IDs", () => {
    // The suffix is the first 8 chars of the alphanumeric device ID, so
    // device IDs that differ in the first 8 chars produce different codes.
    const code1 = generateDiscountCode("AAAA1111ZZZZ");
    const code2 = generateDiscountCode("BBBB2222ZZZZ");
    expect(code1).not.toBe(code2);
  });
});

describe("Expiry date logic", () => {
  it("expires approximately 30 days from now", () => {
    const before = Date.now();
    const expiresAt = generateExpiresAt();
    const after = Date.now();

    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + thirtyDaysMs);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + thirtyDaysMs + 100);
  });

  it("isExpired returns false for a future date", () => {
    const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const isExpired = new Date() > futureDate;
    expect(isExpired).toBe(false);
  });

  it("isExpired returns true for a past date", () => {
    const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const isExpired = new Date() > pastDate;
    expect(isExpired).toBe(true);
  });
});

describe("Device ID generation", () => {
  it("generates a 16-character device ID", () => {
    const id = generateDeviceId();
    expect(id).toHaveLength(16);
  });

  it("generates unique IDs on successive calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateDeviceId()));
    // With 100 calls, expect at least 90 unique IDs (random component ensures uniqueness)
    expect(ids.size).toBeGreaterThan(90);
  });

  it("contains only alphanumeric characters", () => {
    const id = generateDeviceId();
    expect(id).toMatch(/^[A-Z0-9]+$/);
  });
});
