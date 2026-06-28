import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
const clerkKeylessPaths = {
  cjs: resolve(process.cwd(), 'node_modules/@clerk/nextjs/dist/cjs/server/keyless.js'),
  esm: resolve(process.cwd(), 'node_modules/@clerk/nextjs/dist/esm/server/keyless.js'),
};
const clerkSharedKeyPaths = {
  cjs: resolve(process.cwd(), 'node_modules/@clerk/shared/dist/keys.js'),
  esm: resolve(process.cwd(), 'node_modules/@clerk/shared/dist/keys.mjs'),
};

function replaceOnce(source, original, patched, label) {
  if (source.includes(patched)) return { source, changed: false };

  const occurrences = source.split(original).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Unsupported @edgeone/opennextjs-pages ${label}: expected 1 target, found ${occurrences}.`,
    );
  }

  return { source: source.replace(original, patched), changed: true };
}

function replaceExactCount(source, original, patched, expectedCount, label) {
  const occurrences = source.split(original).length - 1;
  if (occurrences === 0) {
    if (source.includes(patched)) return { source, changed: false };
    throw new Error(
      `Unsupported @edgeone/opennextjs-pages ${label}: target is missing and patched form was not found.`,
    );
  }
  if (occurrences !== expectedCount) {
    throw new Error(
      `Unsupported @edgeone/opennextjs-pages ${label}: expected ${expectedCount} targets, found ${occurrences}.`,
    );
  }

  return { source: source.replaceAll(original, patched), changed: true };
}

function writeIfChanged(path, source, changed) {
  if (changed) writeFileSync(path, source);
  return changed;
}

const originalEoData = 'const eoData = request.eo || {};';
const patchedEoData = `const eoData = request.eo && typeof request.eo === 'object'
      ? request.eo
      : {};`;

function patchCompiler() {
const originalBlock = `nextRequest = new NextRequestClass(request, {
          nextConfig: {},
          geo: nextGeo,
          ip: clientIp
        });`;
const patchedBlock = `nextRequest = new NextRequestClass(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
          nextConfig: {},
          geo: nextGeo,
          ip: clientIp
        });`;

let source = readFileSync(compilerPath, 'utf8');
let changed = false;

let result = replaceOnce(source, originalBlock, patchedBlock, `${compilerPath} NextRequest target`);
source = result.source;
changed ||= result.changed;

const wrapperGeoPrefix = '      geo: nextGeo,    // EdgeOne geo';
const wrapperEoMarker = '      eo: eoData,';

if (!source.includes(wrapperEoMarker)) {
  const eoDataOccurrences = source.split(originalEoData).length - 1;
  const wrapperOccurrences = source.split(wrapperGeoPrefix).length - 1;
  if (eoDataOccurrences !== 1 || wrapperOccurrences !== 1) {
    throw new Error(
      `Unsupported @edgeone/opennextjs-pages eo adapter ${compilerPath}: expected one eo source and wrapper target, found ${eoDataOccurrences} and ${wrapperOccurrences}.`,
    );
  }
  source = source
    .replace(originalEoData, patchedEoData)
    .replace(wrapperGeoPrefix, `${wrapperEoMarker}\n${wrapperGeoPrefix}`);
  changed = true;
}

return writeIfChanged(compilerPath, source, changed);
}

function patchWrapper() {
  let source = readFileSync(wrapperPath, 'utf8');
  let changed = false;

  let result = replaceExactCount(
    source,
    originalEoData,
    patchedEoData,
    2,
    `${wrapperPath} eoData normalization`,
  );
  source = result.source;
  changed ||= result.changed;

  const originalRawRequestBlock = `  const newRequest = new Request(request.url, {
    method: request.method,
    headers: newHeaders,
    body: request.body,
  });`;
  const patchedRawRequestBlock = `  const newRequest = new Request(request.url, {
    method: request.method,
    headers: newHeaders,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    eo: eoData,
  });

  Object.defineProperty(newRequest, 'eo', {
    value: eoData,
    writable: true,
    enumerable: true,
    configurable: true
  });`;

  result = replaceOnce(
    source,
    originalRawRequestBlock,
    patchedRawRequestBlock,
    `${wrapperPath} raw RequestInit eo`,
  );
  source = result.source;
  changed ||= result.changed;

  const originalAdapterRequestBlock = `      body: request.body,
      nextConfig: {`;
  const patchedAdapterRequestBlock = `      body: request.body,
      eo: eoData,
      nextConfig: {`;

  result = replaceOnce(
    source,
    originalAdapterRequestBlock,
    patchedAdapterRequestBlock,
    `${wrapperPath} adapter request eo`,
  );
  source = result.source;
  changed ||= result.changed;

  return writeIfChanged(wrapperPath, source, changed);
}

function patchClerkBackendRequest() {
  let changed = false;
  const originalProxyGetBlock = `          if (prop === "signal" || prop === "body") {
            return void 0;
          }
          return Reflect.get(target, prop, target);`;
  const patchedProxyGetBlock = `          if (prop === "signal" || prop === "body") {
            return void 0;
          }
          if (prop === "eo") {
            const value = Reflect.get(target, prop, target);
            return value && typeof value === "object" ? value : {};
          }
          return Reflect.get(target, prop, target);`;

  for (const clerkBackendRequestPath of clerkBackendRequestPaths) {
    let source = readFileSync(clerkBackendRequestPath, 'utf8');
    const result = replaceOnce(
      source,
      originalProxyGetBlock,
      patchedProxyGetBlock,
      `${clerkBackendRequestPath} ClerkRequest eo proxy`,
    );
    source = result.source;
    const fileChanged = writeIfChanged(clerkBackendRequestPath, source, result.changed);
    changed = changed || fileChanged;
  }

  return changed;
}

function patchCryptoPolyfill() {
  let source = readFileSync(cryptoPolyfillPath, 'utf8');
  const originalCryptoDeclaration = `const crypto = globalThis.crypto || {};

// \\u786E\\u4FDD getRandomValues \\u53EF\\u7528`;
  const patchedCryptoDeclaration = `const crypto = globalThis.crypto || {};

if (!crypto.subtle) {
  const nodeCrypto = (() => {
    try {
      return require('node:crypto');
    } catch {
      return undefined;
    }
  })();

  if (nodeCrypto?.webcrypto?.subtle) {
    crypto.subtle = nodeCrypto.webcrypto.subtle;
  } else if (nodeCrypto?.createHash && nodeCrypto?.createHmac) {
    const normalizeAlgorithm = (algorithm) => {
      const name = typeof algorithm === 'string'
        ? algorithm
        : algorithm?.name || algorithm?.hash?.name || algorithm?.hash;
      return String(name).toLowerCase().replace(/-/g, '');
    };
    const toArrayBuffer = (buffer) => (
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    );
    crypto.subtle = {
      async digest(algorithm, data) {
        const hash = nodeCrypto.createHash(normalizeAlgorithm(algorithm));
        hash.update(Buffer.from(data));
        return toArrayBuffer(hash.digest());
      },
      async importKey(format, keyData, algorithm) {
        return { format, keyData, algorithm };
      },
      async sign(algorithm, key, data) {
        const hmac = nodeCrypto.createHmac(
          normalizeAlgorithm(key.algorithm?.hash || algorithm),
          Buffer.from(key.keyData),
        );
        hmac.update(Buffer.from(data));
        return toArrayBuffer(hmac.digest());
      }
    };
  }
}

// \\u786E\\u4FDD getRandomValues \\u53EF\\u7528`;

  if (source.includes(patchedCryptoDeclaration) && !source.includes('createFallbackSubtle')) {
    return false;
  }

  if (source.includes('createFallbackSubtle')) {
    const startIndex = source.indexOf('let crypto = globalThis.crypto || {};');
    const endMarker = '// \\u786E\\u4FDD getRandomValues \\u53EF\\u7528';
    const endIndex = source.indexOf(endMarker, startIndex);
    if (startIndex === -1 || endIndex === -1) {
      throw new Error(
        `Unsupported @edgeone/opennextjs-pages ${cryptoPolyfillPath} oversized crypto fallback migration target.`,
      );
    }
    source = source.slice(0, startIndex) + patchedCryptoDeclaration + source.slice(endIndex + endMarker.length);
    return writeIfChanged(cryptoPolyfillPath, source, true);
  }

  const result = replaceOnce(
    source,
    originalCryptoDeclaration,
    patchedCryptoDeclaration,
    `${cryptoPolyfillPath} Web Crypto subtle fallback`,
  );
  source = result.source;
  return writeIfChanged(cryptoPolyfillPath, source, result.changed);
}

function patchClerkBackendCookieSuffix() {
  let changed = false;

  for (const clerkBackendRequestPath of clerkBackendRequestPaths) {
    let source = readFileSync(clerkBackendRequestPath, 'utf8');
    const result = replaceOnce(
      source,
      'runtime.crypto.subtle) : "";',
      'runtime.crypto?.subtle) : "";',
      `${clerkBackendRequestPath} Clerk cookie suffix optional subtle`,
    );
    source = result.source;
    changed = writeIfChanged(clerkBackendRequestPath, source, result.changed) || changed;
  }

  return changed;
}

function patchClerkSharedKeys() {
  const fallbackSha1 = `function fallbackSha1(data) {
\tconst bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
\tconst bitLength = bytes.length * 8;
\tconst paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
\tconst padded = new Uint8Array(paddedLength);
\tpadded.set(bytes);
\tpadded[bytes.length] = 0x80;
\tconst writeUint32 = (offset, value) => {
\t\tpadded[offset] = value >>> 24;
\t\tpadded[offset + 1] = value >>> 16;
\t\tpadded[offset + 2] = value >>> 8;
\t\tpadded[offset + 3] = value;
\t};
\tconst readUint32 = (offset) => (padded[offset] << 24 | padded[offset + 1] << 16 | padded[offset + 2] << 8 | padded[offset + 3]) >>> 0;
\tconst rotateLeft = (value, bits) => (value << bits | value >>> 32 - bits) >>> 0;
\twriteUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
\twriteUint32(paddedLength - 4, bitLength >>> 0);
\tlet h0 = 0x67452301;
\tlet h1 = 0xefcdab89;
\tlet h2 = 0x98badcfe;
\tlet h3 = 0x10325476;
\tlet h4 = 0xc3d2e1f0;
\tconst w = new Uint32Array(80);
\tfor (let offset = 0; offset < padded.length; offset += 64) {
\t\tfor (let i = 0; i < 16; i++) w[i] = readUint32(offset + i * 4);
\t\tfor (let i = 16; i < 80; i++) w[i] = rotateLeft(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
\t\tlet a = h0, b = h1, c = h2, d = h3, e = h4;
\t\tfor (let i = 0; i < 80; i++) {
\t\t\tlet f, k;
\t\t\tif (i < 20) {
\t\t\t\tf = b & c | ~b & d;
\t\t\t\tk = 0x5a827999;
\t\t\t} else if (i < 40) {
\t\t\t\tf = b ^ c ^ d;
\t\t\t\tk = 0x6ed9eba1;
\t\t\t} else if (i < 60) {
\t\t\t\tf = b & c | b & d | c & d;
\t\t\t\tk = 0x8f1bbcdc;
\t\t\t} else {
\t\t\t\tf = b ^ c ^ d;
\t\t\t\tk = 0xca62c1d6;
\t\t\t}
\t\t\tconst temp = (rotateLeft(a, 5) + f + e + k + w[i]) >>> 0;
\t\t\te = d;
\t\t\td = c;
\t\t\tc = rotateLeft(b, 30);
\t\t\tb = a;
\t\t\ta = temp;
\t\t}
\t\th0 = h0 + a >>> 0;
\t\th1 = h1 + b >>> 0;
\t\th2 = h2 + c >>> 0;
\t\th3 = h3 + d >>> 0;
\t\th4 = h4 + e >>> 0;
\t}
\tconst output = new Uint8Array(20);
\t[h0, h1, h2, h3, h4].forEach((value, index) => {
\t\toutput[index * 4] = value >>> 24;
\t\toutput[index * 4 + 1] = value >>> 16;
\t\toutput[index * 4 + 2] = value >>> 8;
\t\toutput[index * 4 + 3] = value;
\t});
\treturn output.buffer;
}`;
  const originalCjsGetCookieSuffix = `async function getCookieSuffix(publishableKey, subtle = globalThis.crypto.subtle) {
\tconst data = new TextEncoder().encode(publishableKey);
\tconst digest = await subtle.digest("sha-1", data);
\treturn require_isomorphicBtoa.isomorphicBtoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\\+/gi, "-").replace(/\\//gi, "_").substring(0, 8);
}`;
  const patchedCjsGetCookieSuffix = `${fallbackSha1}
async function getCookieSuffix(publishableKey, subtle = globalThis.crypto?.subtle) {
\tconst data = new TextEncoder().encode(publishableKey);
\tconst digest = subtle ? await subtle.digest("sha-1", data) : fallbackSha1(data);
\treturn require_isomorphicBtoa.isomorphicBtoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\\+/gi, "-").replace(/\\//gi, "_").substring(0, 8);
}`;
  const originalEsmGetCookieSuffix = `async function getCookieSuffix(publishableKey, subtle = globalThis.crypto.subtle) {
\tconst data = new TextEncoder().encode(publishableKey);
\tconst digest = await subtle.digest("sha-1", data);
\treturn isomorphicBtoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\\+/gi, "-").replace(/\\//gi, "_").substring(0, 8);
}`;
  const patchedEsmGetCookieSuffix = `${fallbackSha1}
async function getCookieSuffix(publishableKey, subtle = globalThis.crypto?.subtle) {
\tconst data = new TextEncoder().encode(publishableKey);
\tconst digest = subtle ? await subtle.digest("sha-1", data) : fallbackSha1(data);
\treturn isomorphicBtoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\\+/gi, "-").replace(/\\//gi, "_").substring(0, 8);
}`;

  let changed = false;

  {
    let source = readFileSync(clerkSharedKeyPaths.cjs, 'utf8');
    const result = replaceOnce(
      source,
      originalCjsGetCookieSuffix,
      patchedCjsGetCookieSuffix,
      `${clerkSharedKeyPaths.cjs} cookie suffix fallback`,
    );
    source = result.source;
    changed = writeIfChanged(clerkSharedKeyPaths.cjs, source, result.changed) || changed;
  }

  {
    let source = readFileSync(clerkSharedKeyPaths.esm, 'utf8');
    const result = replaceOnce(
      source,
      originalEsmGetCookieSuffix,
      patchedEsmGetCookieSuffix,
      `${clerkSharedKeyPaths.esm} cookie suffix fallback`,
    );
    source = result.source;
    changed = writeIfChanged(clerkSharedKeyPaths.esm, source, result.changed) || changed;
  }

  return changed;
}

function patchClerkKeyless() {
  let changed = false;

  {
    let source = readFileSync(clerkKeylessPaths.cjs, 'utf8');
    const originalImportBlock = `var import_feature_flags = require("../utils/feature-flags");
const keylessCookiePrefix = \`__clerk_keys_\`;`;
    const patchedImportBlock = `var import_feature_flags = require("../utils/feature-flags");
var import_crypto = require("node:crypto");
const resolveSubtleCrypto = () => {
  const subtle = globalThis.crypto?.subtle || import_crypto.webcrypto?.subtle;
  if (!subtle) {
    throw new Error("Clerk keyless requires Web Crypto subtle support.");
  }
  return subtle;
};
const keylessCookiePrefix = \`__clerk_keys_\`;`;
    let result = replaceOnce(
      source,
      originalImportBlock,
      patchedImportBlock,
      `${clerkKeylessPaths.cjs} subtle resolver`,
    );
    source = result.source;
    let fileChanged = result.changed;

    result = replaceOnce(
      source,
      'const hashBuffer = await crypto.subtle.digest("SHA-256", data);',
      'const hashBuffer = await resolveSubtleCrypto().digest("SHA-256", data);',
      `${clerkKeylessPaths.cjs} subtle digest`,
    );
    source = result.source;
    fileChanged ||= result.changed;

    changed = writeIfChanged(clerkKeylessPaths.cjs, source, fileChanged) || changed;
  }

  {
    let source = readFileSync(clerkKeylessPaths.esm, 'utf8');
    const originalImportBlock = `import "../chunk-BUSYA2B4.js";
import { canUseKeyless } from "../utils/feature-flags";
const keylessCookiePrefix = \`__clerk_keys_\`;`;
    const patchedImportBlock = `import "../chunk-BUSYA2B4.js";
import { webcrypto as nodeWebcrypto } from "node:crypto";
import { canUseKeyless } from "../utils/feature-flags";
const resolveSubtleCrypto = () => {
  const subtle = globalThis.crypto?.subtle || nodeWebcrypto?.subtle;
  if (!subtle) {
    throw new Error("Clerk keyless requires Web Crypto subtle support.");
  }
  return subtle;
};
const keylessCookiePrefix = \`__clerk_keys_\`;`;
    let result = replaceOnce(
      source,
      originalImportBlock,
      patchedImportBlock,
      `${clerkKeylessPaths.esm} subtle resolver`,
    );
    source = result.source;
    let fileChanged = result.changed;

    result = replaceOnce(
      source,
      'const hashBuffer = await crypto.subtle.digest("SHA-256", data);',
      'const hashBuffer = await resolveSubtleCrypto().digest("SHA-256", data);',
      `${clerkKeylessPaths.esm} subtle digest`,
    );
    source = result.source;
    fileChanged ||= result.changed;

    changed = writeIfChanged(clerkKeylessPaths.esm, source, fileChanged) || changed;
  }

  return changed;
}

const compilerChanged = patchCompiler();
const wrapperChanged = patchWrapper();
const clerkBackendChanged = patchClerkBackendRequest();
const cryptoPolyfillChanged = patchCryptoPolyfill();
const clerkBackendCookieSuffixChanged = patchClerkBackendCookieSuffix();
const clerkSharedKeysChanged = patchClerkSharedKeys();
const clerkKeylessChanged = patchClerkKeyless();
const changed = compilerChanged || wrapperChanged || clerkBackendChanged || cryptoPolyfillChanged || clerkBackendCookieSuffixChanged || clerkSharedKeysChanged || clerkKeylessChanged;
console.log(
  changed
    ? 'Installed EdgeOne NextRequest adapter.'
    : 'EdgeOne NextRequest adapter is already installed.',
);
