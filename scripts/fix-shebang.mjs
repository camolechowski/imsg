// Ensure dist/cli.js starts with a node shebang and is executable.
import { chmodSync, readFileSync, writeFileSync } from 'fs'

const path = new URL('../dist/cli.js', import.meta.url)
const SHEBANG = '#!/usr/bin/env node'

let src = readFileSync(path, 'utf8')
const lines = src.split('\n')
if (lines[0]?.startsWith('#!')) {
  if (lines[0] !== SHEBANG) {
    lines[0] = SHEBANG
    src = lines.join('\n')
    writeFileSync(path, src)
  }
} else {
  writeFileSync(path, `${SHEBANG}\n${src}`)
}
chmodSync(path, 0o755)
