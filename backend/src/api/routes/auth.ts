import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { registerSchema, loginSchema, refreshTokenSchema } from '../validators/auth.js';
import {
  registerDriver,
  loginDriver,
  refreshAccessToken,
  requestPasswordReset,
  resetPassword,
} from '../../services/auth-service.js';

const router = Router();

router.post('/register', async (req: Request, res: Response, next) => {
  try {
    const input = registerSchema.parse(req.body);
    const result = await registerDriver(input, req.ip, req.headers['user-agent']);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req: Request, res: Response, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const result = await loginDriver(input.email, input.password, req.ip, req.headers['user-agent']);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req: Request, res: Response, next) => {
  try {
    const { refreshToken } = refreshTokenSchema.parse(req.body);
    const result = await refreshAccessToken(refreshToken, req.ip);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

router.post('/forgot-password', async (req: Request, res: Response, next) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    const result = await requestPasswordReset(email, req.ip);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  newPassword: z.string().min(8),
});

router.post('/reset-password', async (req: Request, res: Response, next) => {
  try {
    const input = resetPasswordSchema.parse(req.body);
    const result = await resetPassword(input.email, input.code, input.newPassword, req.ip);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export { router as authRouter };
