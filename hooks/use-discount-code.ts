/**
 * useDiscountCode — local-only implementation.
 *
 * Generates a unique per-device Conway Electric discount code on first use
 * and persists it to AsyncStorage. No server or network call required.
 *
 * Code format: CE-XXXXXXXXXXXXXXXX
 *   - "CE" prefix (Conway Electric)
 *   - 16 uppercase alphanumeric characters derived from device timestamp + random
 *
 * The code is valid for 30 days from the date it was first generated.
 * After expiry the card is hidden (isExpired = true).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

const STORAGE_KEY_DISCOUNT_CODE = "@jouley:discount_code";
const STORAGE_KEY_DISCOUNT_EXPIRES = "@jouley:discount_expires";

export interface DiscountCodeState {
  code: string | null;
  expiresAt: Date | null;
  isExpired: boolean;
  isLoading: boolean;
  createdAt: Date | null;
}

/** Generates a unique per-device code from timestamp + random characters */
function generateLocalCode(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).toUpperCase();
  const suffix = (ts + rand).replace(/[^A-Z0-9]/g, "").slice(0, 16).padEnd(16, "0");
  return `CE-${suffix}`;
}

export function useDiscountCode(): DiscountCodeState {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [createdAt, setCreatedAt] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const [storedCode, storedExpires] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_DISCOUNT_CODE),
          AsyncStorage.getItem(STORAGE_KEY_DISCOUNT_EXPIRES),
        ]);

        if (storedCode && storedExpires) {
          const expiry = new Date(storedExpires);
          if (!cancelled) {
            setCode(storedCode);
            setExpiresAt(expiry);
            setCreatedAt(new Date(expiry.getTime() - 30 * 24 * 60 * 60 * 1000));
            setIsLoading(false);
          }
          return;
        }

        // First open — generate a unique code locally
        const newCode = generateLocalCode();
        const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await Promise.all([
          AsyncStorage.setItem(STORAGE_KEY_DISCOUNT_CODE, newCode),
          AsyncStorage.setItem(STORAGE_KEY_DISCOUNT_EXPIRES, expiry.toISOString()),
        ]);

        if (!cancelled) {
          setCode(newCode);
          setExpiresAt(expiry);
          setCreatedAt(new Date());
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) setIsLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  const isExpired = expiresAt !== null && new Date() > expiresAt;
  return { code, expiresAt, isExpired, isLoading, createdAt };
}
