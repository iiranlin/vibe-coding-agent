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

  const result = replaceOnce(
    source,
    originalCryptoDeclaration,
    patchedCryptoDeclaration,
    `${cryptoPolyfillPath} Web Crypto subtle fallback`,
  );
  source = result.source;
  return writeIfChanged(cryptoPolyfillPath, source, result.changed);
}

const compilerChanged = patchCompiler();
const wrapperChanged = patchWrapper();
const clerkBackendChanged = patchClerkBackendRequest();
const cryptoPolyfillChanged = patchCryptoPolyfill();
const changed = compilerChanged || wrapperChanged || clerkBackendChanged || cryptoPolyfillChanged;
console.log(
  changed
    ? 'Installed EdgeOne NextRequest adapter.'
    : 'EdgeOne NextRequest adapter is already installed.',
);
