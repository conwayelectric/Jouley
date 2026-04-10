/**
 * useDiscountCode
 *
 * On first app open, generates a unique device ID, calls the backend to create
 * a one-time 15% off Shopify discount code, and persists both the code and its
 * expiry date to AsyncStorage so they survive app restarts.
 *
 * The code is shown on the dashboard until it expires (30 days after generation).
 * After expiry the hook returns null and the card is hidden.
 *
 * VERSION FLAG: If the stored code was generated locally (pre-Build 6), it is
 * cleared and a fresh Shopify code is fetched from the server.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

const STORAGE_KEY_DISCOUNT_CODE = "@jouley:discount_code";
const STORAGE_KEY_DISCOUNT_EXPIRES = "@jouley:discount_expires";
const STORAGE_KEY_DEVICE_ID = "@jouley:device_id";
// Version flag — bump this string any time we need to force a re-fetch
const STORAGE_KEY_CODE_VERSION = "@jouley:code_version";
const CURRENT_CODE_VERSION = "shopify-v1";

export interface DiscountCodeState {
  code: string | null;
  expiresAt: Date | null;
  isExpired: boolean;
  isLoading: boolean;
  createdAt: Date | null;
}

/** Generates a stable pseudo-random device ID from timestamp + random bytes */
function generateDeviceId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${ts}${rand}`.slice(0, 16).padEnd(16, "0");
}

export function useDiscountCode(): DiscountCodeState {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [createdAt, setCreatedAt] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const createMutation = trpc.discount.create.useMutation();

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Check version flag — if missing or outdated, clear any stale local code
        const storedVersion = await AsyncStorage.getItem(STORAGE_KEY_CODE_VERSION);
        if (storedVersion !== CURRENT_CODE_VERSION) {
          // Wipe old locally-generated code so we fetch a real Shopify code
          await Promise.all([
            AsyncStorage.removeItem(STORAGE_KEY_DISCOUNT_CODE),
            AsyncStorage.removeItem(STORAGE_KEY_DISCOUNT_EXPIRES),
          ]);
        }

        // Check if we already have a valid server-generated code
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

        // No valid stored code — get or create a device ID and call the server
        let deviceId = await AsyncStorage.getItem(STORAGE_KEY_DEVICE_ID);
        if (!deviceId) {
          deviceId = generateDeviceId();
          await AsyncStorage.setItem(STORAGE_KEY_DEVICE_ID, deviceId);
        }

        const result = await createMutation.mutateAsync({ deviceId });

        if (!cancelled) {
          const expiry = new Date(result.expiresAt);
          const created = new Date(expiry.getTime() - 30 * 24 * 60 * 60 * 1000);

          // Persist the real Shopify code and mark version
          await Promise.all([
            AsyncStorage.setItem(STORAGE_KEY_DISCOUNT_CODE, result.code),
            AsyncStorage.setItem(STORAGE_KEY_DISCOUNT_EXPIRES, result.expiresAt),
            AsyncStorage.setItem(STORAGE_KEY_CODE_VERSION, CURRENT_CODE_VERSION),
          ]);

          setCode(result.code);
          setExpiresAt(expiry);
          setCreatedAt(created);
          setIsLoading(false);
        }
      } catch (err) {
        console.error("[useDiscountCode] Failed to fetch discount code:", err);
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  const isExpired = expiresAt !== null && new Date() > expiresAt;

  return { code, expiresAt, isExpired, isLoading, createdAt };
}
