import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, type TokenPayload } from '../../utils/jwt.js';
import { logger } from '../../config/logger.js';

declare global {
  namespace Express {
    interface Request {
      driver?: TokenPayload;
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyAccessToken(token);
    req.driver = payload;
    next();
  } catch (err) {
    logger.warn({ err, ip: req.ip }, 'Invalid access token');
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRegion(...regions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.driver || !regions.includes(req.driver.region)) {
      res.status(403).json({ error: 'Insufficient permissions for this region' });
      return;
    }
    next();
  };
}
