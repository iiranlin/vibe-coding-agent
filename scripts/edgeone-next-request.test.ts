import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const compilerPath = resolve(
  process.cwd(),
  'node_modules/@edgeone/opennextjs-pages/dist/build/functions/middleware/compiler.js',
);

describe('EdgeOne NextRequest 适配', () => {
  it('不把带有平台私有 eo 字段的原始 Request 直接传给 NextRequest', () => {
    const compilerSource = readFileSync(compilerPath, 'utf8');

    expect(compilerSource).not.toContain('new NextRequestClass(request, {');
    expect(compilerSource).toContain('new NextRequestClass(request.url, {');
    expect(compilerSource).toContain('headers: request.headers');
  });
});
