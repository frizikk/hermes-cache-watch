// Optional local integration smoke; portable unit tests remain dependency-free.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const source = process.env.HERMES_SOURCE
if (!source || !path.isAbsolute(source)) {
  console.error('Set HERMES_SOURCE to an absolute Hermes source checkout with existing Desktop dependencies. No dependencies will be installed.')
  process.exitCode = 1
} else {
  let scratch
  try {
    const desktop = path.join(source, 'apps/desktop')
    const require = createRequire(path.join(desktop, 'package.json'))
    const resolve = name => require.resolve(name)
    const sdk = path.join(desktop, 'src/sdk/index.ts')
    const setup = path.join(desktop, 'vitest.setup.ts')
    for (const file of [sdk, setup]) fs.accessSync(file, fs.constants.R_OK)
    const runner = path.join(path.dirname(resolve('vitest/package.json')), 'vitest.mjs')
    fs.accessSync(runner, fs.constants.R_OK)
    const aliases = {
      '@hermes/plugin-sdk': sdk,
      '@': path.join(desktop, 'src'),
      '@hermes/shared/billing': path.join(source, 'apps/shared/src/billing-types.ts'),
      '@hermes/shared': path.join(source, 'apps/shared/src'),
      'react': path.dirname(resolve('react/package.json')),
      'react-dom': path.dirname(resolve('react-dom/package.json')),
      '@testing-library/react': resolve('@testing-library/react'),
      'vitest': path.join(path.dirname(runner), 'dist/index.js'),
      'cache-watch-plugin': fileURLToPath(new URL('./plugin.js', import.meta.url))
    }
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-watch-host-'))
    fs.copyFileSync(new URL('./host-smoke.test.mjs', import.meta.url), path.join(scratch, 'host-smoke.test.mjs'))
    const config = path.join(scratch, 'vitest.config.mjs')
    fs.writeFileSync(config, 'export default ' + JSON.stringify({
      root: scratch,
      resolve: { alias: aliases },
      test: { environment: 'jsdom', setupFiles: [setup], include: ['host-smoke.test.mjs'], testTimeout: 30000, env: { NODE_ENV: 'development' } }
    }))
    const result = spawnSync(process.execPath, [runner, 'run', '--config', config], {
      cwd: scratch, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' }
    })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } catch (error) {
    console.error(`Host smoke unavailable/failed: ${error.message}`)
    process.exitCode = 1
  } finally {
    // Remove only this invocation's newly allocated sandbox, never host files.
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true })
  }
}
