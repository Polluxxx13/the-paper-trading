import path from 'node:path';

/** Configuration lue depuis l'environnement (voir .env.example et README). */
const isProd = process.env.NODE_ENV === 'production';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

const jwtSecret = required('JWT_SECRET');
const appPassword = required('APP_PASSWORD');
// Une application publique protégée par un mot de passe trop faible n'a pas de sens : on refuse de démarrer.
if (jwtSecret.length < 16) throw new Error('JWT_SECRET doit contenir au moins 16 caractères');
if (appPassword.length < 8) throw new Error('APP_PASSWORD doit contenir au moins 8 caractères');

export const config = {
  isProd,
  // Cookie "secure" : vrai en prod (HTTPS Render) ; COOKIE_SECURE=false pour HTTP sur un NAS.
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
  port: Number(process.env.PORT ?? 8080), // Render injecte PORT
  databaseUrl: required('DATABASE_URL'),
  // Render Postgres (URL externe) impose SSL ; l'URL interne non.
  databaseSsl: process.env.DATABASE_SSL === 'true',
  appPassword,
  jwtSecret,
  sessionHours: Number(process.env.SESSION_HOURS ?? 24 * 7),
  snapshotTime: process.env.SNAPSHOT_TIME ?? '22:05', // HH:MM dans snapshotTz
  snapshotTz: process.env.SNAPSHOT_TZ ?? 'Europe/Zurich',
  schemaPath: process.env.SCHEMA_PATH ?? path.resolve(__dirname, '../../db/schema.sql'),
  staticDir: process.env.STATIC_DIR ?? path.resolve(__dirname, '../../frontend/dist'),
};
