import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const compilerPath = resolve(
  process.cwd(),
  'node_modules/@edgeone/opennextjs-pages/dist/build/functions/middleware/compiler.js',
);

describe('EdgeOne NextRequest 适配', () => {
  it('为 Clerk 创建的 RequestInit 提供规范化的 eo 对象', () => {
    const compilerSource = readFileSync(compilerPath, 'utf8');

    expect(compilerSource).not.toContain('new NextRequestClass(request, {');
    expect(compilerSource).toContain('new NextRequestClass(request.url, {');
    expect(compilerSource).toContain('headers: request.headers');
    expect(compilerSource).toContain("typeof request.eo === 'object'");
    expect(compilerSource).toContain('eo: eoData');
  });
});
