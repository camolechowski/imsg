import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

// Rebuild the synthetic fixture db before every test run so a mutated or
// stale tests/fixtures/chat.db can never leak state between runs.
const root = join(import.meta.dir, '..')
const res = spawnSync('node', [join(root, 'scripts', 'make-fixture.ts')], {
  cwd: root,
  encoding: 'utf8',
})
if (res.status !== 0) {
  throw new Error(`fixture rebuild failed: ${res.stderr || res.stdout}`)
}
