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

const source = readFileSync(compilerPath, 'utf8');
if (source.includes(patchedBlock)) {
  console.log('EdgeOne NextRequest adapter is already installed.');
  process.exit(0);
}

const occurrences = source.split(originalBlock).length - 1;
if (occurrences !== 1) {
  throw new Error(
    `Unsupported @edgeone/opennextjs-pages compiler ${compilerPath}: expected 1 NextRequest target, found ${occurrences}.`,
  );
}

writeFileSync(compilerPath, source.replace(originalBlock, patchedBlock));
console.log('Installed EdgeOne NextRequest adapter.');
