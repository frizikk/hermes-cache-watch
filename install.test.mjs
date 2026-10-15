import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { install, files } from './install.mjs'
const source = path.dirname(fileURLToPath(import.meta.url))
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-watch-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true })) // Only our newly created sandbox.
  return { root, home: path.join(root, 'home'), target: path.join(root, 'home', 'desktop-plugins', 'cache-watch') }
}
function same(target) { for (const name of files) assert.deepEqual(fs.readFileSync(path.join(target,name)),fs.readFileSync(path.join(source,name))) }
test('installer CLI honors isolated HERMES_HOME and preserves configuration and unrelated plugins', t => {
  const {home,target}=fixture(t)
  fs.mkdirSync(path.join(home,'desktop-plugins','other'),{recursive:true})
  fs.writeFileSync(path.join(home,'config.yaml'),'unchanged')
  fs.writeFileSync(path.join(home,'desktop-plugins','other','plugin.js'),'untouched')
  const result=spawnSync(process.execPath,[path.join(source,'install.mjs')],{env:{...process.env,HERMES_HOME:home},encoding:'utf8'})
  assert.equal(result.status,0,result.stderr); same(target)
  assert.equal(fs.readFileSync(path.join(home,'config.yaml'),'utf8'),'unchanged')
  assert.equal(fs.readFileSync(path.join(home,'desktop-plugins','other','plugin.js'),'utf8'),'untouched')
})
test('replacement requires opt-in, preserves extra files and backs up all overwritten bytes', t => {
  const {home,target}=fixture(t); install({home})
  fs.appendFileSync(path.join(target,'plugin.js'),'\n// old')
  fs.writeFileSync(path.join(target,'custom.txt'),'keep')
  assert.throws(()=>install({home}),/--replace/)
  const result=install({home,replace:true}); same(target)
  assert.match(fs.readFileSync(path.join(result.backup,'plugin.js'),'utf8'),/\/\/ old$/)
  assert.equal(fs.readFileSync(path.join(target,'custom.txt'),'utf8'),'keep')
})
test('installer refuses relative, empty and root HERMES_HOME', () => {
  for (const home of ['', '.', path.parse(process.cwd()).root]) assert.throws(()=>install({home}),/HERMES_HOME/)
})
test('installer refuses symlink directories without touching their targets', t => {
  const {root,home}=fixture(t); const outside=path.join(root,'outside')
  fs.mkdirSync(outside); fs.mkdirSync(home); fs.symlinkSync(outside,path.join(home,'desktop-plugins'),'dir')
  assert.throws(()=>install({home,replace:true}),/symlink/); assert.deepEqual(fs.readdirSync(outside),[])
})
test('installer refuses symlink destination files', t => {
  const {root,home,target}=fixture(t); install({home})
  const outside=path.join(root,'outside'); fs.writeFileSync(outside,'untouched')
  fs.unlinkSync(path.join(target,'README.md')); fs.symlinkSync(outside,path.join(target,'README.md'))
  assert.throws(()=>install({home,replace:true}),/symlink/); assert.equal(fs.readFileSync(outside,'utf8'),'untouched')
})
test('installer refuses managed copies and unrelated occupied folders', t => {
  const {home,target}=fixture(t); fs.mkdirSync(target,{recursive:true}); fs.writeFileSync(path.join(target,'notes'),'keep')
  assert.throws(()=>install({home,replace:true}),/unrelated/)
  fs.writeFileSync(path.join(target,'plugin.js'),"export default {id:'other'}")
  assert.throws(()=>install({home,replace:true}),/does not identify/)
  fs.writeFileSync(path.join(target,'.hermes-package.json'),'{}')
  assert.throws(()=>install({home,replace:true}),/managed/)
})
test('installer preflights non-file targets before replacing plugin entry point', t => {
  const {home,target}=fixture(t); install({home}); const before=fs.readFileSync(path.join(target,'plugin.js'))
  fs.unlinkSync(path.join(target,'test.mjs')); fs.mkdirSync(path.join(target,'test.mjs'))
  assert.throws(()=>install({home,replace:true}),/regular file/); assert.deepEqual(fs.readFileSync(path.join(target,'plugin.js')),before)
})
test('installer rejects unsupported CLI flags before filesystem changes', t => {
  const {home}=fixture(t)
  const result=spawnSync(process.execPath,[path.join(source,'install.mjs'),'--uninstall'],{env:{...process.env,HERMES_HOME:home},encoding:'utf8'})
  assert.equal(result.status,1); assert.equal(fs.existsSync(home),false)
})
