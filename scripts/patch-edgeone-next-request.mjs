import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const compilerPath = resolve(
  process.cwd(),
  'node_modules/@edgeone/opennextjs-pages/dist/build/functions/middleware/compiler.js',
);
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

if (!source.includes(patchedBlock)) {
  const occurrences = source.split(originalBlock).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Unsupported @edgeone/opennextjs-pages compiler ${compilerPath}: expected 1 NextRequest target, found ${occurrences}.`,
    );
  }
  source = source.replace(originalBlock, patchedBlock);
  changed = true;
}

const originalEoData = 'const eoData = request.eo || {};';
const patchedEoData = `const eoData = request.eo && typeof request.eo === 'object'
      ? request.eo
      : {};`;
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

if (changed) writeFileSync(compilerPath, source);
console.log(
  changed
    ? 'Installed EdgeOne NextRequest adapter.'
    : 'EdgeOne NextRequest adapter is already installed.',
);
