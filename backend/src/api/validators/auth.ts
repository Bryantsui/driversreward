import { z } from 'zod';

export const registerSchema = z.object({
  phone: z.string().min(8).max(20).regex(/^\+?\d+$/, 'Phone must contain only digits and optional leading +'),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(200),
  email: z.string().email().max(255).optional(),
  region: z.enum(['HK', 'BR']),
  referralCode: z.string().max(20).optional(),
  consentDataCollection: z.literal(true, {
    errorMap: () => ({ message: 'Data collection consent is required' }),
  }),
});

export const loginSchema = z.object({
  phone: z.string().min(8).max(20),
  password: z.string(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
