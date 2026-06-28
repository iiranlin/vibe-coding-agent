import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
const clerkBackendCjsRuntimePaths = [
  'node_modules/@clerk/backend/dist/index.js',
  'node_modules/@clerk/backend/dist/internal.js',
  'node_modules/@clerk/backend/dist/jwt/index.js',
].map((path) => resolve(process.cwd(), path));
const clerkBackendEsmRuntimePath = resolve(
  process.cwd(),
  'node_modules/@clerk/backend/dist/chunk-7E7A3JZN.mjs',
);
const clerkKeylessPaths = [
  'node_modules/@clerk/nextjs/dist/cjs/server/keyless.js',
  'node_modules/@clerk/nextjs/dist/esm/server/keyless.js',
].map((path) => resolve(process.cwd(), path));
const clerkSharedKeyPaths = [
  'node_modules/@clerk/shared/dist/keys.js',
  'node_modules/@clerk/shared/dist/keys.mjs',
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

  it('在 Clerk runtime 没有 subtle 时仍能生成一致的 cookie suffix', async () => {
    for (const clerkSharedKeyPath of clerkSharedKeyPaths) {
      const clerkSharedKeySource = readFileSync(clerkSharedKeyPath, 'utf8');

      expect(clerkSharedKeySource).toContain('fallbackSha1');
      expect(clerkSharedKeySource).toContain('globalThis.crypto?.subtle');
    }

    const { getCookieSuffix } = await import(
      pathToFileURL(resolve(process.cwd(), 'node_modules/@clerk/shared/dist/keys.mjs')).href
    );
    const publishableKey = 'pk_test_dGVzdC5jbGVyay5hY2NvdW50cy5kZXYk';
    const suffixWithRuntimeSubtle = await getCookieSuffix(
      publishableKey,
      globalThis.crypto.subtle,
    );
    const suffixWithoutRuntimeSubtle = await getCookieSuffix(publishableKey, null);

    expect(suffixWithoutRuntimeSubtle).toBe(suffixWithRuntimeSubtle);
  });

  it('避免 Clerk backend 在创建 cookie suffix 时强制读取 runtime.crypto.subtle', () => {
    for (const clerkBackendRequestPath of clerkBackendRequestPaths) {
      const clerkSource = readFileSync(clerkBackendRequestPath, 'utf8');

      expect(clerkSource).not.toContain('runtime.crypto.subtle) : "";');
      expect(clerkSource).toContain('runtime.crypto?.subtle) : "";');
    }
  });

  it('让 Clerk JWT 验签使用 EdgeOne 提供的 crypto 对象', () => {
    for (const clerkBackendRuntimePath of clerkBackendCjsRuntimePaths) {
      const clerkSource = readFileSync(clerkBackendRuntimePath, 'utf8');

      expect(clerkSource).not.toContain('crypto: import_crypto.webcrypto,');
      expect(clerkSource).toContain(
        'crypto: import_crypto.webcrypto || import_crypto || globalThis.crypto,',
      );
    }

    const clerkEsmSource = readFileSync(clerkBackendEsmRuntimePath, 'utf8');
    expect(clerkEsmSource).not.toContain('var runtime = {\n  crypto,');
    expect(clerkEsmSource).toContain('crypto: crypto || globalThis.crypto,');
  });

  it('在 EdgeOne 拒绝 Clerk RSA 参数时使用规范化参数重试', () => {
    for (const clerkBackendRuntimePath of [
      ...clerkBackendCjsRuntimePaths,
      clerkBackendEsmRuntimePath,
    ]) {
      const clerkSource = readFileSync(clerkBackendRuntimePath, 'utf8');

      expect(clerkSource).toContain('normalizeEdgeOneJwtAlgorithm');
      expect(clerkSource).toContain('normalizeEdgeOneJwk');
      expect(clerkSource).toContain('error?.message !== "Param Invalid"');
      expect(clerkSource).toContain('{ name: algorithm.name },');
    }
  });

  it('使用 EdgeOne 兼容参数完成 Clerk JWT importKey 和 verify', async () => {
    const clerkJwt = await import(
      `${pathToFileURL(clerkBackendEsmRuntimePath).href}?edgeone-rsa-params`
    );
    const mutableRuntime = clerkJwt.runtime as { crypto: unknown };
    const originalCrypto = mutableRuntime.crypto;
    const importCalls: unknown[][] = [];
    const verifyCalls: unknown[][] = [];
    const importedKey = { type: 'public' };

    mutableRuntime.crypto = {
      subtle: {
        async importKey(...args: unknown[]) {
          importCalls.push(args);
          if (importCalls.length === 1) throw new Error('Param Invalid');
          return importedKey;
        },
        async verify(...args: unknown[]) {
          verifyCalls.push(args);
          return true;
        },
      },
    };

    try {
      const jwk = {
        kty: 'RSA',
        n: 'modulus',
        e: 'AQAB',
        kid: 'test-key',
        alg: 'RS256',
        use: 'sig',
      };
      const algorithm = {
        name: 'RSASSA-PKCS1-v1_5',
        hash: { name: 'SHA-256' },
      };
      const result = await clerkJwt.importKey(jwk, algorithm, 'verify');

      expect(result).toBe(importedKey);
      expect(importCalls).toHaveLength(2);
      expect(importCalls[1]?.[1]).toEqual({ kty: 'RSA', n: 'modulus', e: 'AQAB' });
      expect(importCalls[1]?.[2]).toEqual({
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      });

      const signatureResult = await clerkJwt.hasValidSignature(
        {
          header: { alg: 'RS256' },
          signature: new Uint8Array([1]),
          raw: { header: 'header', payload: 'payload' },
        },
        jwk,
      );

      expect(signatureResult).toEqual({ data: true });
      expect(verifyCalls[0]?.[0]).toEqual({ name: 'RSASSA-PKCS1-v1_5' });
    } finally {
      mutableRuntime.crypto = originalCrypto;
    }
  });

  it('避免 Clerk keyless helper 直接读取裸 crypto.subtle', () => {
    for (const clerkKeylessPath of clerkKeylessPaths) {
      const clerkKeylessSource = readFileSync(clerkKeylessPath, 'utf8');

      expect(clerkKeylessSource).not.toContain('await crypto.subtle.digest');
      expect(clerkKeylessSource).toContain('resolveSubtleCrypto');
    }
  });
});
