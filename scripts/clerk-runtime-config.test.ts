import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Clerk Edge 运行时配置', () => {
  it('在构建前生成可由 Proxy 直接导入的服务端配置', () => {
    const workingDirectory = mkdtempSync(resolve(tmpdir(), 'clerk-runtime-'));
    temporaryDirectories.push(workingDirectory);
    const outputPath = resolve(workingDirectory, 'clerk-runtime-config.ts');

    execFileSync(
      process.execPath,
      [resolve(process.cwd(), 'scripts/write-edgeone-clerk-env.mjs')],
      {
        cwd: workingDirectory,
        env: {
          ...process.env,
          CLERK_RUNTIME_CONFIG_PATH: outputPath,
          CLERK_SECRET_KEY: 'sk_test_unit',
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_unit',
        },
        stdio: 'pipe',
      },
    );

    const source = readFileSync(outputPath, 'utf8');
    expect(source).toContain('export const clerkRuntimeConfig');
    expect(source).toContain('process.env[key] = value');
    expect(source).toContain('sk_test_unit');
    expect(source).toContain('pk_test_unit');

    const proxySource = readFileSync(resolve(process.cwd(), 'proxy.ts'), 'utf8');
    expect(proxySource.indexOf("import './.generated/clerk-runtime-config';"))
      .toBeLessThan(proxySource.indexOf("import { clerkMiddleware }"));
    expect(proxySource).toContain('export default clerkMiddleware();');
  });
});
