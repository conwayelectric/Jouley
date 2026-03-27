import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { createUniqueDiscountCode } from "./shopify.js";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  discount: router({
    /**
     * Creates a unique one-time 15% off Shopify discount code for the given device ID.
     * Called once on first app open; the code is stored in AsyncStorage on the device.
     * If called again with the same deviceId, the server should ideally be idempotent,
     * but since codes are stored client-side we simply create a new one if needed.
     */
    create: publicProcedure
      .input(
        z.object({
          deviceId: z.string().min(8).max(64),
        })
      )
      .mutation(async ({ input }) => {
        const result = await createUniqueDiscountCode(input.deviceId);
        return {
          code: result.code,
          expiresAt: result.expiresAt,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
