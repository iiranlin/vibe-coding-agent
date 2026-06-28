import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const middlewareDirectory = resolve(
  process.cwd(),
  'node_modules/@edgeone/opennextjs-pages/dist/build/functions/middleware',
);
const targets = [
  { path: resolve(middlewareDirectory, 'wrapper.js'), expectedOccurrences: 2 },
  { path: resolve(middlewareDirectory, 'compiler.js'), expectedOccurrences: 1 },
];
const compilerEntryPath = resolve(middlewareDirectory, 'middleware.js');
const originalSignature = 'async function executeMiddleware({request}) {';
const patchedSignature = 'async function executeMiddleware({request, env}) {';
const bridgeMarker = "key.startsWith('NEXT_PUBLIC_CLERK_')";
const environmentBridge = `${patchedSignature}
  if (env && typeof env === 'object') {
    for (const [key, value] of Object.entries(env)) {
      if (
        typeof value === 'string'
        && (key.startsWith('CLERK_') || key.startsWith('NEXT_PUBLIC_CLERK_'))
      ) {
        process.env[key] = value;
      }
    }
  }`;

let patchedFiles = 0;

for (const target of targets) {
  const source = readFileSync(target.path, 'utf8');
  if (source.includes(bridgeMarker)) continue;

  const occurrences = source.split(originalSignature).length - 1;
  if (occurrences !== target.expectedOccurrences) {
    throw new Error(
      `Unsupported @edgeone/opennextjs-pages middleware source ${target.path}: expected ${target.expectedOccurrences} targets, found ${occurrences}.`,
    );
  }

  writeFileSync(target.path, source.replaceAll(originalSignature, environmentBridge));
  patchedFiles += 1;
}

const turbopackCompilerPath = resolve(middlewareDirectory, 'compiler.js');
const turbopackCompilerSource = readFileSync(turbopackCompilerPath, 'utf8');
const turbopackEnvironmentMarker = '// === Turbopack Environment Variables ===';
if (!turbopackCompilerSource.includes(turbopackEnvironmentMarker)) {
  const originalSetup = [
    '  const polyfillsCode = getPolyfillsCode();',
    '  const turbopackCompatCode = getSimplifiedTurbopackCompat(entryModuleId);',
  ].join('\n');
  const patchedSetup = [
    '  const polyfillsCode = getPolyfillsCode();',
    '  let envCode = "";',
    '  if (options.env) {',
    '    const envEntries = Object.entries(options.env).map(([key, value]) => `process.env[${JSON.stringify(key)}] = ${JSON.stringify(value)};`).join("\\n");',
    '    envCode = `',
    '// === Turbopack Environment Variables ===',
    '${envEntries}',
    '`;',
    '  }',
    '  const turbopackCompatCode = getSimplifiedTurbopackCompat(entryModuleId);',
  ].join('\n');
  const originalOutput = '${polyfillsCode}\n\n${turbopackCompatCode}';
  const patchedOutput = '${polyfillsCode}\n\n${envCode}\n\n${turbopackCompatCode}';
  const setupOccurrences = turbopackCompilerSource.split(originalSetup).length - 1;
  const outputOccurrences = turbopackCompilerSource.split(originalOutput).length - 1;
  if (setupOccurrences !== 1 || outputOccurrences !== 1) {
    throw new Error(
      `Unsupported @edgeone/opennextjs-pages Turbopack compiler ${turbopackCompilerPath}: expected one setup and output target, found ${setupOccurrences} and ${outputOccurrences}.`,
    );
  }

  writeFileSync(
    turbopackCompilerPath,
    turbopackCompilerSource
      .replace(originalSetup, patchedSetup)
      .replace(originalOutput, patchedOutput),
  );
  patchedFiles += 1;
}

const compilerEntrySource = readFileSync(compilerEntryPath, 'utf8');
const compilerEnvironmentMarker = 'edgeone-clerk-env.json';
if (!compilerEntrySource.includes(compilerEnvironmentMarker)) {
  const originalCompilerBlock = `const result = await compile(middlewareFilePath, {
    env: { DEBUG: "true" }
  });`;
  const legacyCompilerBlock = `const result = await compile(middlewareFilePath, {
    env: {
      DEBUG: "true",
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key, value]) =>
          typeof value === "string" &&
          (key.startsWith("CLERK_") || key.startsWith("NEXT_PUBLIC_CLERK_"))
        )
      )
    }
  });`;
  const compilerBlock = `const clerkEnvironmentPath = join(
    process.cwd(),
    "node_modules/.cache/edgeone-clerk-env.json"
  );
  const clerkEnvironment = existsSync(clerkEnvironmentPath)
    ? JSON.parse(readFileSync(clerkEnvironmentPath, "utf8"))
    : {};
  const result = await compile(middlewareFilePath, {
    env: { DEBUG: "true", ...clerkEnvironment }
  });`;
  const sourceBlock = compilerEntrySource.includes(legacyCompilerBlock)
    ? legacyCompilerBlock
    : originalCompilerBlock;
  const occurrences = compilerEntrySource.split(sourceBlock).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Unsupported @edgeone/opennextjs-pages compiler entry ${compilerEntryPath}: expected 1 target, found ${occurrences}.`,
    );
  }

  writeFileSync(compilerEntryPath, compilerEntrySource.replace(sourceBlock, compilerBlock));
  patchedFiles += 1;
}

console.log(
  patchedFiles > 0
    ? `Installed EdgeOne Clerk middleware environment bridge in ${patchedFiles} file(s).`
    : 'EdgeOne Clerk middleware environment bridge is already installed.',
);
