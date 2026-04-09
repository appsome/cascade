import { protectedProcedure, router } from '../trpc.js';

export const systemRouter = router({
	getPublicUrl: protectedProcedure.query(() => {
		const routerPublicUrl = process.env.WEBHOOK_CALLBACK_BASE_URL ?? null;
		return { routerPublicUrl };
	}),
});
