import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(200),
  phone: z.string().max(50).optional(),
  region: z.enum(['HK', 'BR']),
  referralCode: z.string().max(20).optional(),
  consentDataCollection: z.literal(true, {
    errorMap: () => ({ message: 'Data collection consent is required' }),
  }),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
