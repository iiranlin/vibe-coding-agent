import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const middlewareSources = [
  'wrapper.js',
  'compiler.js',
].map((fileName) => resolve(
  process.cwd(),
  'node_modules/@edgeone/opennextjs-pages/dist/build/functions/middleware',
  fileName,
));
const middlewareCompilerEntry = resolve(
  process.cwd(),
  'node_modules/@edgeone/opennextjs-pages/dist/build/functions/middleware/middleware.js',
);

describe('EdgeOne Next.js middleware environment bridge', () => {
  it('copies Clerk variables from the EdgeOne context before running Proxy', () => {
    for (const sourcePath of middlewareSources) {
      const source = readFileSync(sourcePath, 'utf8');

      expect(source).toContain('async function executeMiddleware({request, env}) {');
      expect(source).toContain("key.startsWith('CLERK_')");
      expect(source).toContain("key.startsWith('NEXT_PUBLIC_CLERK_')");
    }

    const turbopackCompilerSource = readFileSync(middlewareSources[1], 'utf8');
    expect(turbopackCompilerSource).toContain('// === Turbopack Environment Variables ===');
    expect(turbopackCompilerSource).toContain('${polyfillsCode}\n\n${envCode}\n\n${turbopackCompatCode}');

    const compilerEntrySource = readFileSync(middlewareCompilerEntry, 'utf8');
    expect(compilerEntrySource).toContain('edgeone-clerk-env.json');
    expect(compilerEntrySource).toContain('env: { DEBUG: "true", ...clerkEnvironment }');
  });
});
