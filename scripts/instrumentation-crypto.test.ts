import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Next.js instrumentation crypto polyfill', () => {
  it('在 Node server 启动时为 EdgeOne SSR runtime 提供 Web Crypto', () => {
    const instrumentation = readFileSync(resolve(process.cwd(), 'instrumentation.ts'), 'utf8');
    const nodeInstrumentation = readFileSync(
      resolve(process.cwd(), 'instrumentation-node.ts'),
      'utf8',
    );

    expect(instrumentation).toContain("process.env.NEXT_RUNTIME === 'nodejs'");
    expect(instrumentation).toContain("import('./instrumentation-node')");
    expect(instrumentation).not.toContain("import('node:crypto')");
    expect(nodeInstrumentation).toContain("from 'node:crypto'");
    expect(nodeInstrumentation).toContain('globalThis.crypto');
    expect(nodeInstrumentation).toContain('webcrypto');
  });
});
