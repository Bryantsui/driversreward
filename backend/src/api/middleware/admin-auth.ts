import type { Request, Response, NextFunction } from 'express';
import { verifyAdminToken, type AdminTokenPayload } from '../../utils/admin-jwt.js';
import { logger } from '../../config/logger.js';

declare global {
  namespace Express {
    interface Request {
      admin?: AdminTokenPayload;
    }
  }
}

export async function authenticateAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyAdminToken(token);
    req.admin = payload;
    next();
  } catch (err) {
    logger.warn({ err, ip: req.ip }, 'Invalid admin token');
    res.status(401).json({ error: 'Invalid or expired admin token' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      res.status(403).json({ error: 'Insufficient admin permissions' });
      return;
    }
    next();
  };
}
