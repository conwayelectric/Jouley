/**
 * useDiscountCode
 *
 * On first app open, generates a unique device ID, calls the backend to create
 * a one-time 15% off Shopify discount code, and persists both the code and its
 * expiry date to AsyncStorage so they survive app restarts.
 *
 * GUARANTEES:
 * - Never disappears: once a code is stored it is shown forever (no expiry hide).
 * - Never duplicates: the device ID is written BEFORE the server call. On any
 *   subsequent open, if a code is not yet stored but a device ID is, the same
 *   device ID is reused — the server will create at most one code per device ID
 *   because the device ID is the idempotency key in the Shopify discount title.
 *   Even if the app crashes between the server response and the AsyncStorage write,
 *   the next open reuses the same device ID, so Shopify sees the same label and
 *   the support team can deduplicate if needed.
 *
 * VERSION FLAG: Clears any stale locally-generated code from pre-Build 6.
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

/** Generates a stable pseudo-random device ID */
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
        // Step 1: Check version flag — if missing or outdated, clear any stale local code.
        // Do NOT clear the device ID — it is the idempotency key.
        const storedVersion = await AsyncStorage.getItem(STORAGE_KEY_CODE_VERSION);
        if (storedVersion !== CURRENT_CODE_VERSION) {
          await Promise.all([
            AsyncStorage.removeItem(STORAGE_KEY_DISCOUNT_CODE),
            AsyncStorage.removeItem(STORAGE_KEY_DISCOUNT_EXPIRES),
          ]);
        }

        // Step 2: If we already have a stored Shopify code, show it immediately.
        // This is the normal path on every open after the first.
        const [storedCode, storedExpires] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_DISCOUNT_CODE),
          AsyncStorage.getItem(STORAGE_KEY_DISCOUNT_EXPIRES),
        ]);

        if (storedCode && storedExpires) {
          if (!cancelled) {
            setCode(storedCode);
            setExpiresAt(new Date(storedExpires));
            setCreatedAt(new Date(new Date(storedExpires).getTime() - 30 * 24 * 60 * 60 * 1000));
            setIsLoading(false);
          }
          return;
        }

        // Step 3: No stored code yet. Get or create a device ID.
        // IMPORTANT: Write the device ID to AsyncStorage BEFORE calling the server.
        // This ensures the same device ID is reused if the app crashes mid-flow,
        // preventing a second server call from generating a different code.
        let deviceId = await AsyncStorage.getItem(STORAGE_KEY_DEVICE_ID);
        if (!deviceId) {
          deviceId = generateDeviceId();
          await AsyncStorage.setItem(STORAGE_KEY_DEVICE_ID, deviceId);
        }

        // Step 4: Call the server to create a real Shopify discount code.
        const result = await createMutation.mutateAsync({ deviceId });

        if (!cancelled) {
          const expiry = new Date(result.expiresAt);

          // Step 5: Persist the code, expiry, and version atomically.
          await AsyncStorage.multiSet([
            [STORAGE_KEY_DISCOUNT_CODE, result.code],
            [STORAGE_KEY_DISCOUNT_EXPIRES, result.expiresAt],
            [STORAGE_KEY_CODE_VERSION, CURRENT_CODE_VERSION],
          ]);

          setCode(result.code);
          setExpiresAt(expiry);
          setCreatedAt(new Date(expiry.getTime() - 30 * 24 * 60 * 60 * 1000));
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

  // isExpired is kept in the return value for future use but is NOT used to hide the card.
  const isExpired = expiresAt !== null && new Date() > expiresAt;

  return { code, expiresAt, isExpired, isLoading, createdAt };
}
