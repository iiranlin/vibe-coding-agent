import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const clerkEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key, value]) => (
    typeof value === 'string'
    && (key.startsWith('CLERK_') || key.startsWith('NEXT_PUBLIC_CLERK_'))
  )),
);
const requiredVariables = [
  'CLERK_SECRET_KEY',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
];
const missingVariables = requiredVariables.filter((key) => !clerkEnvironment[key]);

if (missingVariables.length > 0) {
  throw new Error(`Missing Clerk build environment variables: ${missingVariables.join(', ')}`);
}

const cachePath = resolve(
  process.cwd(),
  'node_modules/.cache/edgeone-clerk-env.json',
);
mkdirSync(dirname(cachePath), { recursive: true });
writeFileSync(cachePath, JSON.stringify(clerkEnvironment), { mode: 0o600 });
chmodSync(cachePath, 0o600);
console.log('Prepared Clerk environment for EdgeOne middleware compilation.');
