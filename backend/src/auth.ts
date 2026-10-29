import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config';

export const COOKIE = 'pt_session';

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const hmac = (data: string) => crypto.createHmac('sha256', config.jwtSecret).update(data).digest('base64url');

/** Jeton signé HMAC "payload.signature" (payload = expiration en ms). */
export function issueToken(): string {
  const payload = b64(String(Date.now() + config.sessionHours * 3600_000));
  return `${payload}.${hmac(payload)}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(Buffer.from(payload, 'base64url').toString()) > Date.now();
}

export function passwordMatches(input: string): boolean {
  const a = crypto.createHash('sha256').update(input).digest();
  const b = crypto.createHash('sha256').update(config.appPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Hook global : toute route /api (sauf login/healthz) exige une session valide. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!verifyToken(req.cookies[COOKIE])) {
    return reply.code(401).send({ error: 'unauthorized', message: 'Connexion requise' });
  }
}
