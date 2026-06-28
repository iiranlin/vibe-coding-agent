import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const requiredVariables = [
  'CLERK_SECRET_KEY',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
];
const missingVariables = requiredVariables.filter((key) => !process.env[key]);

if (missingVariables.length > 0) {
  throw new Error(`Missing Clerk build environment variables: ${missingVariables.join(', ')}`);
}

const outputPath = process.env.CLERK_RUNTIME_CONFIG_PATH || resolve(
  process.cwd(),
  '.generated/clerk-runtime-config.ts',
);
const runtimeConfig = {
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  secretKey: process.env.CLERK_SECRET_KEY,
};
const runtimeEnvironment = {
  CLERK_SECRET_KEY: runtimeConfig.secretKey,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: runtimeConfig.publishableKey,
};
const moduleSource = [
  '// This file is generated before local development and production builds.',
  '// It must remain server-only and must not be committed.',
  `const clerkRuntimeEnvironment = ${JSON.stringify(runtimeEnvironment, null, 2)} as const;`,
  '',
  "if (typeof process !== 'undefined' && process.env) {",
  '  for (const [key, value] of Object.entries(clerkRuntimeEnvironment)) {',
  '    process.env[key] = value;',
  '  }',
  '}',
  '',
  `export const clerkRuntimeConfig = ${JSON.stringify(runtimeConfig, null, 2)} as const;`,
  '',
].join('\n');

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, moduleSource, { mode: 0o600 });
chmodSync(outputPath, 0o600);
console.log('Prepared Clerk runtime configuration for Edge middleware.');
