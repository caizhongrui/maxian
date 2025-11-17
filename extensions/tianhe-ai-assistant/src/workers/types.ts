import { z } from "zod"

export type WorkerMessage = any

export const countTokensResultSchema = z.object({
	tokenCount: z.number(),
	error: z.string().optional(),
})

export type CountTokensResult = z.infer<typeof countTokensResultSchema>
