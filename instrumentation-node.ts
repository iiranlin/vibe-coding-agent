import { webcrypto } from 'node:crypto';

registerNodeCrypto();

export function registerNodeCrypto() {
  if (globalThis.crypto?.subtle || !webcrypto?.subtle) return;

  const crypto = webcrypto as unknown as typeof globalThis.crypto;
  const target = globalThis as typeof globalThis & {
    crypto?: typeof globalThis.crypto;
  };

  try {
    Object.defineProperty(target, 'crypto', {
      value: crypto,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  } catch {
    try {
      target.crypto = crypto;
    } catch {
      // If the runtime exposes a non-configurable crypto without subtle,
      // keep startup non-fatal and let the original runtime error surface.
    }
  }
}
