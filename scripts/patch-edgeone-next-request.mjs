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
  const legacyPatchedCryptoDeclaration = `const crypto = globalThis.crypto || {};

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
  const patchedCryptoDeclaration = `let crypto = globalThis.crypto || {};

const normalizeAlgorithm = (algorithm) => {
  const name = typeof algorithm === 'string'
    ? algorithm
    : algorithm?.name || algorithm?.hash?.name || algorithm?.hash;
  return String(name).toLowerCase().replace(/[-_]/g, '');
};
const toUint8Array = (data) => {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView?.(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data === 'string') return new TextEncoder().encode(data);
  return new Uint8Array(data || []);
};
const toArrayBuffer = (bytes) => (
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
);
const concatBytes = (...parts) => {
  const normalized = parts.map(toUint8Array);
  const total = normalized.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of normalized) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};
const writeUint32BE = (target, offset, value) => {
  target[offset] = value >>> 24;
  target[offset + 1] = value >>> 16;
  target[offset + 2] = value >>> 8;
  target[offset + 3] = value;
};
const readUint32BE = (source, offset) => (
  ((source[offset] << 24) | (source[offset + 1] << 16) | (source[offset + 2] << 8) | source[offset + 3]) >>> 0
);
const rotateLeft = (value, bits) => ((value << bits) | (value >>> (32 - bits))) >>> 0;
const rotateRight = (value, bits) => ((value >>> bits) | (value << (32 - bits))) >>> 0;
const padMessage = (message) => {
  const bytes = toUint8Array(message);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 1 + 8) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  writeUint32BE(padded, paddedLength - 8, Math.floor(bitLength / 0x100000000));
  writeUint32BE(padded, paddedLength - 4, bitLength >>> 0);
  return padded;
};
const hashSha1 = (message) => {
  const padded = padMessage(message);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = readUint32BE(padded, offset + i * 4);
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rotateLeft(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f;
      let k;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotateLeft(a, 5) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const output = new Uint8Array(20);
  [h0, h1, h2, h3, h4].forEach((value, index) => writeUint32BE(output, index * 4, value));
  return output;
};
const sha256K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
const hashSha256 = (message) => {
  const padded = padMessage(message);
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = readUint32BE(padded, offset + i * 4);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotateRight(w[i - 15], 7) ^ rotateRight(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotateRight(w[i - 2], 17) ^ rotateRight(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i++) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + sha256K[i] + w[i]) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  const output = new Uint8Array(32);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((value, index) => writeUint32BE(output, index * 4, value));
  return output;
};
const digestBytes = (algorithm, data) => {
  const algorithmName = normalizeAlgorithm(algorithm);
  if (algorithmName === 'sha1') return hashSha1(data);
  if (algorithmName === 'sha256') return hashSha256(data);
  throw new Error('Unsupported crypto.subtle algorithm: ' + algorithmName);
};
const createFallbackSubtle = () => ({
  async digest(algorithm, data) {
    return toArrayBuffer(digestBytes(algorithm, data));
  },
  async importKey(format, keyData, algorithm, extractable, keyUsages) {
    return { format, keyData: toUint8Array(keyData), algorithm, extractable, keyUsages };
  },
  async sign(algorithm, key, data) {
    const algorithmName = normalizeAlgorithm(algorithm);
    if (algorithmName !== 'hmac') {
      throw new Error('Unsupported crypto.subtle sign algorithm: ' + algorithmName);
    }
    const hashAlgorithm = key.algorithm?.hash || algorithm.hash || 'SHA-256';
    const hashName = normalizeAlgorithm(hashAlgorithm);
    const blockSize = 64;
    let keyBytes = toUint8Array(key.keyData);
    if (keyBytes.length > blockSize) keyBytes = digestBytes(hashName, keyBytes);
    const normalizedKey = new Uint8Array(blockSize);
    normalizedKey.set(keyBytes);
    const ipad = new Uint8Array(blockSize);
    const opad = new Uint8Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      ipad[i] = normalizedKey[i] ^ 0x36;
      opad[i] = normalizedKey[i] ^ 0x5c;
    }
    const inner = digestBytes(hashName, concatBytes(ipad, data));
    return toArrayBuffer(digestBytes(hashName, concatBytes(opad, inner)));
  },
  async verify(algorithm, key, signature, data) {
    const expected = new Uint8Array(await this.sign(algorithm, key, data));
    const actual = toUint8Array(signature);
    if (expected.length !== actual.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
    return diff === 0;
  }
});
const setCryptoSubtle = (subtle) => {
  try {
    crypto.subtle = subtle;
  } catch {}
  if (!crypto.subtle) {
    crypto = { ...crypto, subtle };
  }
};
const installCryptoGlobal = () => {
  try {
    Object.defineProperty(globalThis, 'crypto', {
      value: crypto,
      configurable: true,
      enumerable: false,
      writable: true
    });
  } catch {}
  try {
    if (!globalThis.crypto) globalThis.crypto = crypto;
  } catch {}
};

if (!crypto.subtle) {
  const nodeCrypto = (() => {
    try {
      return require('node:crypto');
    } catch {
      return undefined;
    }
  })();

  if (nodeCrypto?.webcrypto?.subtle) {
    setCryptoSubtle(nodeCrypto.webcrypto.subtle);
  } else if (nodeCrypto?.createHash && nodeCrypto?.createHmac) {
    setCryptoSubtle({
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
    });
  } else {
    setCryptoSubtle(createFallbackSubtle());
  }
}

installCryptoGlobal();

// \\u786E\\u4FDD getRandomValues \\u53EF\\u7528`;

  if (source.includes(patchedCryptoDeclaration)) {
    return false;
  }

  let changed = false;
  if (source.includes(legacyPatchedCryptoDeclaration)) {
    source = source.replace(legacyPatchedCryptoDeclaration, patchedCryptoDeclaration);
    changed = true;
  } else {
    const result = replaceOnce(
      source,
      originalCryptoDeclaration,
      patchedCryptoDeclaration,
      `${cryptoPolyfillPath} Web Crypto subtle fallback`,
    );
    source = result.source;
    changed = result.changed;
  }

  return writeIfChanged(cryptoPolyfillPath, source, changed);
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
const clerkKeylessChanged = patchClerkKeyless();
const changed = compilerChanged || wrapperChanged || clerkBackendChanged || cryptoPolyfillChanged || clerkKeylessChanged;
console.log(
  changed
    ? 'Installed EdgeOne NextRequest adapter.'
    : 'EdgeOne NextRequest adapter is already installed.',
);
