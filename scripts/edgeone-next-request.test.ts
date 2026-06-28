import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
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

function extractCryptoPolyfill(source: string) {
  const match = source.match(/var cryptoPolyfill = `([\s\S]*)`;\nexport/);
  expect(match).toBeTruthy();
  return match![1];
}

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

  it('在 Edge runtime 没有 WebCrypto 和 Node crypto 时安装最小 subtle', async () => {
    const cryptoPolyfillSource = readFileSync(cryptoPolyfillPath, 'utf8');
    const cryptoPolyfill = extractCryptoPolyfill(cryptoPolyfillSource);
    const context = {
      ArrayBuffer,
      Buffer,
      Math,
      TextEncoder,
      Uint8Array,
    } as typeof globalThis & { crypto?: Crypto };

    context.globalThis = context;
    runInNewContext(cryptoPolyfill, context);

    expect(context.crypto?.subtle?.digest).toBeTypeOf('function');
    const sha1Digest = await context.crypto!.subtle.digest('sha-1', new TextEncoder().encode('test'));
    const sha256Digest = await context.crypto!.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('abc'),
    );
    const hmacKey = await context.crypto!.subtle.importKey(
      'raw',
      new TextEncoder().encode('key'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const hmacSignature = await context.crypto!.subtle.sign(
      'HMAC',
      hmacKey,
      new TextEncoder().encode('data'),
    );

    expect(Buffer.from(sha1Digest).toString('hex')).toBe(
      'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3',
    );
    expect(Buffer.from(sha256Digest).toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(Buffer.from(hmacSignature).toString('hex')).toBe(
      '5031fe3d989c6d1537a013fa6e739da23463fdaec3b70137d828e36ace221bd0',
    );
  });

  it('避免 Clerk keyless helper 直接读取裸 crypto.subtle', () => {
    for (const clerkKeylessPath of clerkKeylessPaths) {
      const clerkKeylessSource = readFileSync(clerkKeylessPath, 'utf8');

      expect(clerkKeylessSource).not.toContain('await crypto.subtle.digest');
      expect(clerkKeylessSource).toContain('resolveSubtleCrypto');
    }
  });
});
