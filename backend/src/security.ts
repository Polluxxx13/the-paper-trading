import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config';

/** En-têtes de sécurité appliqués à toutes les réponses. */
export function applySecurityHeaders(req: FastifyRequest, reply: FastifyReply) {
  reply
    .header('X-Content-Type-Options', 'nosniff')
    .header('X-Frame-Options', 'DENY')
    .header('Referrer-Policy', 'no-referrer')
    .header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
    .header('Cross-Origin-Opener-Policy', 'same-origin')
    .header(
      'Content-Security-Policy',
      // style-src 'unsafe-inline' : styles dynamiques de React / SVG ; aucun script en ligne n'est autorisé
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  if (config.cookieSecure) reply.header('Strict-Transport-Security', 'max-age=15552000');
  if (req.url.startsWith('/api')) reply.header('Cache-Control', 'no-store'); // jamais de données de compte en cache
}

/**
 * Anti-CSRF / anti-détournement WebSocket : un en-tête Origin présent doit correspondre à l'hôte servi.
 * (Les clients sans Origin — curl, même origine en GET — sont acceptés ; le cookie SameSite=Strict protège déjà le reste.)
 */
export function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export const requestHost = (req: FastifyRequest) => (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0].trim() ?? req.headers.host;

export function originAllowed(req: FastifyRequest): boolean {
  return sameOrigin(req.headers.origin, requestHost(req));
}
