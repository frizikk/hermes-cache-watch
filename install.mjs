import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

export const files = ['README.md', 'test.mjs', 'plugin.js'] // Entry point published last.
const source = path.dirname(fileURLToPath(import.meta.url))
function stat(p) {
  try { return fs.lstatSync(p) } catch (e) { if (e.code === 'ENOENT') return null; throw e }
}
function safePath(p) {
  for (let current = path.resolve(p); ; current = path.dirname(current)) {
    const s = stat(current)
    if (s?.isSymbolicLink()) throw Error(`Refusing symlink: ${current}`)
    if (current === path.dirname(current)) break
  }
}
export function install({ home = process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes'), replace = false } = {}) {
  if (!home || !path.isAbsolute(home)) throw Error('HERMES_HOME must be a nonempty absolute path')
  home = path.resolve(home)
  if (home === path.parse(home).root) throw Error('Refusing filesystem root as HERMES_HOME')
  const target = path.join(home, 'desktop-plugins', 'cache-watch')
  safePath(target)
  if (stat(target) && !stat(target).isDirectory()) throw Error(`Not a directory: ${target}`)
  if (stat(path.join(target, '.hermes-package.json'))) throw Error('Refusing a managed unified-package copy')
  const existing = files.filter(name => stat(path.join(target, name)))
  for (const name of files) {
    safePath(path.join(target, name))
    const s = stat(path.join(target, name))
    if (s && !s.isFile()) throw Error(`Not a regular file: ${name}`)
  }
  if (stat(target) && fs.readdirSync(target).length && !existing.includes('plugin.js')) throw Error('Refusing unrelated nonempty folder without plugin.js')
  if (existing.length && !replace) throw Error('Existing files: review them, then pass --replace to back up and replace only the managed files')
  if (existing.includes('plugin.js') && !/\bid:\s*['"]cache-watch['"]/.test(fs.readFileSync(path.join(target, 'plugin.js'), 'utf8'))) throw Error('Existing plugin does not identify as cache-watch')
  // Read every source before writing anything; never recursively copy a checkout.
  const contents = new Map(files.map(name => [name, fs.readFileSync(path.join(source, name))]))
  let backup = null
  if (existing.length) {
    const backupRoot = path.join(home, 'cache', 'cache-watch-backups')
    safePath(backupRoot)
    fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 })
    backup = fs.mkdtempSync(path.join(backupRoot, 'install-'))
    for (const name of existing) fs.copyFileSync(path.join(target, name), path.join(backup, name), fs.constants.COPYFILE_EXCL)
  }
  fs.mkdirSync(target, { recursive: true })
  const staged = []
  try {
    for (const [name, content] of contents) {
      const temp = path.join(target, `.${name}.${randomUUID()}.tmp`)
      fs.writeFileSync(temp, content, { flag: 'wx', mode: 0o644 })
      staged.push([temp, path.join(target, name)])
    }
    for (const [temp, destination] of staged) fs.renameSync(temp, destination)
    for (const [name, content] of contents) {
      if (!fs.readFileSync(path.join(target, name)).equals(content)) throw Error(`Verification failed: ${name}`)
    }
  } finally {
    for (const [temp] of staged) if (stat(temp)) fs.unlinkSync(temp)
  }
  return { target, backup, files }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.some(arg => arg !== '--replace') || args.length > 1) throw Error('Usage: node install.mjs [--replace]')
    console.log(JSON.stringify(install({ replace: args.includes('--replace') }), null, 2))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
