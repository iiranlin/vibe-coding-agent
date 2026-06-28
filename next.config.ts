import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

const config = {
  turbopack: {
    root,
  },
};

export default config;
