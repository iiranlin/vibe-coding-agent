import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const middlewareDirectory = resolve(
  process.cwd(),
  'node_modules/@edgeone/opennextjs-pages/dist/build/functions/middleware',
);
const targets = [
  { path: resolve(middlewareDirectory, 'wrapper.js'), expectedOccurrences: 2 },
  { path: resolve(middlewareDirectory, 'compiler.js'), expectedOccurrences: 1 },
];
const originalSignature = 'async function executeMiddleware({request}) {';
const patchedSignature = 'async function executeMiddleware({request, env}) {';
const bridgeMarker = "key.startsWith('NEXT_PUBLIC_CLERK_')";
const environmentBridge = `${patchedSignature}
  if (env && typeof env === 'object') {
    for (const [key, value] of Object.entries(env)) {
      if (
        typeof value === 'string'
        && (key.startsWith('CLERK_') || key.startsWith('NEXT_PUBLIC_CLERK_'))
      ) {
        process.env[key] = value;
      }
    }
  }`;

let patchedFiles = 0;

for (const target of targets) {
  const source = readFileSync(target.path, 'utf8');
  if (source.includes(bridgeMarker)) continue;

  const occurrences = source.split(originalSignature).length - 1;
  if (occurrences !== target.expectedOccurrences) {
    throw new Error(
      `Unsupported @edgeone/opennextjs-pages middleware source ${target.path}: expected ${target.expectedOccurrences} targets, found ${occurrences}.`,
    );
  }

  writeFileSync(target.path, source.replaceAll(originalSignature, environmentBridge));
  patchedFiles += 1;
}

console.log(
  patchedFiles > 0
    ? `Installed EdgeOne Clerk middleware environment bridge in ${patchedFiles} file(s).`
    : 'EdgeOne Clerk middleware environment bridge is already installed.',
);
