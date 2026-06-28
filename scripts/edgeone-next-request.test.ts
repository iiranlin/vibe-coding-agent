import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const compilerPath = resolve(
  process.cwd(),
  'node_modules/@edgeone/opennextjs-pages/dist/build/functions/middleware/compiler.js',
);
const wrapperPath = resolve(
  process.cwd(),
  'node_modules/@edgeone/opennextjs-pages/dist/build/functions/middleware/wrapper.js',
);
const cryptoPolyfillPath = resolve(
  process.cwd(),
  'node_modules/@edgeone/opennextjs-pages/dist/build/functions/middleware/polyfills/crypto.js',
);
const clerkBackendRequestPaths = [
  'node_modules/@clerk/backend/dist/index.js',
  'node_modules/@clerk/backend/dist/internal.js',
  'node_modules/@clerk/backend/dist/chunk-7KNTREEZ.mjs',
].map((path) => resolve(process.cwd(), path));
const clerkKeylessPaths = [
  'node_modules/@clerk/nextjs/dist/cjs/server/keyless.js',
  'node_modules/@clerk/nextjs/dist/esm/server/keyless.js',
].map((path) => resolve(process.cwd(), path));

describe('EdgeOne NextRequest 适配', () => {
  it('为 Clerk 创建的 RequestInit 提供规范化的 eo 对象', () => {
    const compilerSource = readFileSync(compilerPath, 'utf8');

    expect(compilerSource).not.toContain('new NextRequestClass(request, {');
    expect(compilerSource).toContain('new NextRequestClass(request.url, {');
    expect(compilerSource).toContain('headers: request.headers');
    expect(compilerSource).toContain("typeof request.eo === 'object'");
    expect(compilerSource).toContain('eo: eoData');
  });

  it('为 EdgeOne middleware wrapper 中的 RequestInit 提供 eo 对象', () => {
    const wrapperSource = readFileSync(wrapperPath, 'utf8');

    expect(wrapperSource).not.toContain('const eoData = request.eo || {};');
    expect(wrapperSource).toContain("typeof request.eo === 'object'");
    expect(wrapperSource).toContain('eo: eoData');
    expect(wrapperSource).toContain("Object.defineProperty(newRequest, 'eo'");
  });

  it('为 ClerkRequest 的 Proxy clone 路径提供默认 eo 对象', () => {
    for (const clerkBackendRequestPath of clerkBackendRequestPaths) {
      const clerkSource = readFileSync(clerkBackendRequestPath, 'utf8');

      expect(clerkSource).toContain('prop === "eo"');
      expect(clerkSource).toContain('typeof value === "object" ? value : {};');
    }
  });

  it('为 EdgeOne crypto polyfill 提供 Web Crypto subtle 兜底', () => {
    const cryptoPolyfillSource = readFileSync(cryptoPolyfillPath, 'utf8');

    expect(cryptoPolyfillSource).toContain('if (!crypto.subtle)');
    expect(cryptoPolyfillSource).toContain("require('node:crypto')");
    expect(cryptoPolyfillSource).toContain('nodeCrypto.webcrypto.subtle');
  });

  it('避免 Clerk keyless helper 直接读取裸 crypto.subtle', () => {
    for (const clerkKeylessPath of clerkKeylessPaths) {
      const clerkKeylessSource = readFileSync(clerkKeylessPath, 'utf8');

      expect(clerkKeylessSource).not.toContain('await crypto.subtle.digest');
      expect(clerkKeylessSource).toContain('resolveSubtleCrypto');
    }
  });
});
