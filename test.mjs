import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source = fs.readFileSync(new URL('./plugin.js', import.meta.url), 'utf8')
function atom(value) { const listeners = new Set(); return { get: () => value, set(v) { value = v; listeners.forEach(f => f(v)) }, subscribe(f) { listeners.add(f); f(value); return () => listeners.delete(f) }, listeners } }
function fixture(saved = null) {
  let time = 1800000000000, writes = 0, seq = 0
  const sends = [], listeners = new Set(), timers = new Map(), disposers = [], contributions = []
  const state = Object.fromEntries(Object.entries({ activeSessionId: 'runtime-a', focusedSessionId: 'runtime-a', focusedStoredSessionId: 'stored-a', focusedSessionOwner: { connectionId: '', profile: 'default' }, profile: 'default', connectionId: '', gateway: 'open', busy: false, awaitingResponse: false, busyBySession: {}, model: 'codex' }).map(([k,v]) => [k, atom(v)]))
  const host = { state, composer: { submit(id,text) { sends.push({ id,text }); return true } }, onEvent(type,fn) { listeners.add(fn); return () => listeners.delete(fn) } }
  const storage = { get: () => saved, set(k,v) { writes++; saved = JSON.parse(JSON.stringify(v)) } }
  const render = (type,props) => ({ type,props })
  const sandbox = { host, atom, useValue: a => a.get(), useCallback: fn => fn, useSyncExternalStore: (subscribe, snapshot) => snapshot(), Tip: 'Tip', SESSION_ROW_AREAS: { trailing: 'sessionRow.trailing' }, Button: 'Button', Input: 'Input', Popover: 'Popover', PopoverTrigger: 'PopoverTrigger', PopoverContent: 'PopoverContent', jsx: render, jsxs: render, Date, Map, Set, FormData, setInterval(fn,ms) { const id = timers.size + 1; timers.set(id,{fn,ms}); return id }, clearInterval(id) { timers.delete(id) } }
  vm.createContext(sandbox)
  vm.runInContext(source.replace(/^import .*\n/gm, '').replace(/export default /, 'globalThis.plugin = ').replace(/export (const|function) /g, '$1 ') + '\nglobalThis.factory = createWatch;', sandbox)
  const watch = sandbox.factory({ host, storage, now: () => time })
  return { watch, host, state, sends, storage, listeners, timers, disposers, contributions, sandbox, advance(ms) { time += ms }, saved: () => saved, writes: () => writes, event(type,payload={},extras={}) { watch.handle({ type, payload, session_id: state.focusedSessionId.get(), profile: 'default', connectionId: '', seq: ++seq, replayEpoch: 'epoch-1', ...extras }) }, register() { sandbox.plugin.register({ storage, onDispose(fn) { disposers.push(fn) }, register(c) { contributions.push(c) } }) } }
}
test('unknown on first load; info running/start and historic usage are not LLM timestamps', () => {
  const f=fixture(); f.event('session.info',{ stored_session_id:'stored-a',running:false,turn_started_at:123, usage:{calls:4} }); assert.equal(f.watch.view().age,null)
  f.event('message.start'); assert.equal(f.watch.view().age,null); assert.equal(f.watch.view().busy,true)
})
test('fake clock tracks output and exact warning/TTL thresholds; never sends automatically', () => {
  const f=fixture(); f.event('message.delta',{text:'hello'}); f.advance(25*60000); assert.equal(f.watch.view().level,'warning'); f.advance(5*60000); assert.equal(f.watch.view().level,'expired'); f.watch.tick(); f.watch.flush(); assert.equal(f.sends.length,0)
})
test('duplicate/out-of-order/replayed frames do not reset time', () => {
  const f=fixture(); f.event('message.delta',{text:'x'},{seq:9}); f.advance(1000)
  f.event('message.delta',{text:'x'},{seq:9}); f.event('message.delta',{text:'x'},{seq:8}); f.event('message.delta',{text:'x'},{seq:10,replayed:true}); assert.equal(f.watch.view().age,1000)
})
test('new backend epoch resets sequence domain, not previous time', () => {
  const f=fixture(); f.event('message.delta',{text:'x'},{seq:99}); f.advance(1000); f.event('message.delta',{text:'new'},{seq:1,replayEpoch:'epoch-2'}); assert.equal(f.watch.view().age,0)
})
test('tools, errors, empty chunks and lifecycle updates are not activity', () => {
  const f=fixture(); f.event('message.delta',{text:'x'}); f.advance(1000)
  for(const type of ['tool.start','tool.complete','status.update','error','message.start']) f.event(type,{text:'not model'})
  f.event('message.delta',{text:''}); assert.equal(f.watch.view().age,1000)
})
test('usage counts only update on increase; repeated ticker never extends TTL', () => {
  const f=fixture(); f.event('session.usage',{usage:{calls:3}}); assert.equal(f.watch.view().age,null)
  f.event('session.usage',{usage:{calls:4}}); f.advance(1000); f.event('session.usage',{usage:{calls:4}}); assert.equal(f.watch.view().age,1000)
})
test('non-streaming successful response after observed start is tracked', () => {
  const f=fixture(); f.event('message.start'); f.event('message.complete',{text:'OK',status:'complete',usage:{calls:1}}); assert.equal(f.watch.view().age,0); assert.equal(f.watch.view().busy,false)
})
test('failed response without observed model output stays unknown', () => {
  const f=fixture(); f.event('message.start'); f.event('message.complete',{text:'error',status:'error',usage:{calls:0}}); assert.equal(f.watch.view().age,null)
})
test('wrong session/profile/connection cannot reset focused session', () => {
  const f=fixture(); f.event('message.delta',{text:'x'},{session_id:'wrong'}); f.event('message.delta',{text:'x'},{profile:'other'}); f.event('message.delta',{text:'x'},{connectionId:'remote'}); assert.equal(f.watch.view().age,null)
})
test('background session metadata is separate and becomes visible when focused', () => {
  const f=fixture(); f.event('session.info',{stored_session_id:'stored-b'},{session_id:'runtime-b'}); f.event('message.delta',{text:'x'},{session_id:'runtime-b'}); assert.equal(f.watch.view().age,null)
  f.state.focusedSessionId.set('runtime-b'); f.state.focusedStoredSessionId.set('stored-b'); assert.equal(f.watch.view().age,0)
})
test('legacy untagged event accepted only for focused ambient session', () => {
  const f=fixture(); f.event('message.delta',{text:'x'},{profile:undefined,session_id:'other'}); assert.equal(f.watch.view().age,null); f.event('message.delta',{text:'x'},{profile:undefined}); assert.equal(f.watch.view().age,0)
})
test('manual send uses exact runtime via normal composer, no timestamp optimism or double click', () => {
  const f=fixture(); assert.equal(f.watch.send(),true); assert.equal(f.watch.send(),false); assert.equal(f.sends.length,1); assert.equal(f.sends[0].id,'runtime-a'); assert.match(f.sends[0].text,/bez narzędzi/); assert.equal(f.watch.view().age,null)
})
test('send reads live focus rather than stale render target', () => {
  const f=fixture(); f.watch.view(); f.state.focusedSessionId.set('runtime-b'); f.state.focusedStoredSessionId.set('stored-b'); f.watch.send(); assert.equal(f.sends[0].id,'runtime-b')
})
test('busy, awaiting, per-session busy and disconnected all fail closed', () => {
  for(const [field,val] of [['busy',true],['awaitingResponse',true],['busyBySession',{'runtime-a':true}],['gateway','connecting'],['focusedSessionId',null]]) { const f=fixture(); f.state[field].set(val); assert.equal(f.watch.send(),false,field); assert.equal(f.sends.length,0) }
})
test('foreign owner and missing busy/composer API fail closed', () => {
  const f=fixture(); f.state.focusedSessionOwner.set({profile:'other',connectionId:''}); assert.equal(f.watch.send(),false)
  const g=fixture(); delete g.host.state.busy; assert.equal(g.watch.send(),false)
  const h=fixture(); delete h.host.composer; assert.equal(h.watch.send(),false)
})
test('unclaimed composer and thrown dispatch error handled with no retry', () => {
  const f=fixture(); f.host.composer.submit=()=>false; assert.equal(f.watch.send(),false); assert.match(f.watch.view().notice,/Brak widocznego/)
  const g=fixture(); let n=0; g.host.composer.submit=()=>{n++; throw Error('failure')}; assert.equal(g.watch.send(),false); assert.equal(g.watch.send(),false); assert.equal(n,1); g.advance(60000); g.watch.tick(); assert.equal(n,1)
})
test('gateway error surfaces without resetting timer or automated retries', () => {
  const f=fixture(); f.watch.send(); f.event('error',{message:'bad'}); assert.match(f.watch.view().notice,/błąd/); assert.equal(f.watch.view().age,null); assert.equal(f.sends.length,1)
})
test('reload restores bounded metadata and duplicate high water, never transcript', () => {
  const f=fixture(); f.event('message.delta',{text:'SECRET TRANSCRIPT'},{seq:90}); f.watch.flush(); const saved=f.saved(); assert.ok(!JSON.stringify(saved).includes('SECRET')); const g=fixture(saved); g.advance(1000); g.event('message.delta',{text:'duplicate'},{seq:90}); assert.equal(g.watch.view().age,1000)
})
test('timestamp persists across runtime rebind via stored session id', () => {
  const f=fixture(); f.event('message.delta',{text:'x'}); f.watch.flush(); const g=fixture(f.saved()); g.state.focusedSessionId.set('runtime-new'); g.advance(1000); assert.equal(g.watch.view().age,1000)
})
test('input validation and settings persist across reload', () => {
  const f=fixture(); for(const args of [[0,0],[2,2],[30,NaN],[Infinity,1],[1441,1],[3.5,1]]) assert.equal(f.watch.configure(...args),false)
  assert.equal(f.watch.configure(60,50),true); const g=fixture(f.saved()); assert.equal(g.watch.view().settings.ttl,60)
})
test('persistence bounded and prunes future/old timestamps', () => {
  const f=fixture(); for(let i=0;i<200;i++) f.event('message.delta',{text:'x'},{session_id:`s${i}`}); f.watch.flush(); assert.ok(f.saved().records.length<=128); assert.ok(f.saved().sequences.length<=128)
  const g=fixture({records:[{key:'future',at:9999999999999},{key:'ancient',at:1}]}); assert.equal(g.watch.view().age,null)
})
test('dispose flushes and ignores late events and send; no persistence after disposal', () => {
  const f=fixture(); f.event('message.delta',{text:'x'}); f.watch.dispose(); const n=f.writes(); f.advance(1000); f.event('message.delta',{text:'late'}); f.watch.flush(); assert.equal(f.writes(),n); assert.equal(f.watch.view().age,1000); assert.equal(f.watch.send(),false)
})
test('register/statusbar UI renders; disable/hot reload cleans all timers/listeners', () => {
  const f=fixture(); f.register(); assert.equal(f.listeners.size,1); assert.equal(f.timers.size,2); assert.equal(f.contributions[0].area,'statusBar.right')
  const leaf=f.contributions[0].render(); const tree=leaf.type(leaf.props); assert.equal(tree.type,'Popover')
  f.disposers.forEach(fn=>fn()); assert.equal(f.listeners.size,0); assert.equal(f.timers.size,0); for(const a of Object.values(f.state)) assert.equal(a.listeners.size,0)
  f.register(); assert.equal(f.listeners.size,1); assert.equal(f.timers.size,2); f.disposers.slice(1).forEach(fn=>fn()); assert.equal(f.timers.size,0)
})
const row = (f, id) => { const value = f.watch.rowSnapshot(id); return value ? JSON.parse(value) : null }
test('sidebar rows have distinct ages independent of focus; unknown rows disappear', () => {
  const f=fixture(); f.event('message.delta',{text:'a'}); f.advance(12*60000)
  f.event('session.info',{stored_session_id:'stored-b'},{session_id:'runtime-b'})
  f.event('message.delta',{text:'b'},{session_id:'runtime-b'}); f.advance(2*60000)
  assert.equal(row(f,'stored-a')[0],14); assert.equal(row(f,'stored-b')[0],2)
  assert.equal(row(f,'unknown'),null); assert.equal(row(f,'runtime-b'),null)
  f.state.focusedSessionId.set('runtime-b'); f.state.focusedStoredSessionId.set('stored-b')
  assert.equal(row(f,'stored-a')[0],14); assert.equal(row(f,'stored-b')[0],2)
})
test('sidebar scoped owner collisions fail closed across profiles and connections, even without output', () => {
  for(const extra of [{profile:'other'},{connectionId:'remote'}]) {
    const f=fixture(); f.event('message.delta',{text:'a'})
    f.event('session.info',{stored_session_id:'stored-a'},{session_id:'another-runtime',...extra})
    assert.equal(row(f,'stored-a'),null)
  }
  const f=fixture(); f.event('message.delta',{text:'a'}); f.state.focusedSessionOwner.set(null); assert.equal(row(f,'stored-a'),null)
  f.state.focusedSessionOwner.set({connectionId:'foreign',profile:'default'}); assert.equal(row(f,'stored-a'),null)
})
test('background rows carry their own unique profile and connection, not ambient values', () => {
  const f=fixture(); const scope={session_id:'runtime-z',profile:'worker',connectionId:'remote'}
  f.event('session.info',{stored_session_id:'stored-z'},scope); f.event('message.delta',{text:'z'},scope)
  assert.deepEqual(row(f,'stored-z'),[0,'fresh','remote','worker']); assert.equal(row(f,'stored-a'),null)
})
test('runtime-to-durable alias migrates early observations and survives stored tip rotation', () => {
  const f=fixture(); const scope={session_id:'runtime-b'}
  f.event('message.delta',{text:'b'},scope); f.advance(60000)
  f.event('session.info',{stored_session_id:'root-b'},scope)
  assert.equal(row(f,'root-b')[0],1); assert.equal(row(f,'runtime-b'),null)
  f.event('session.info',{stored_session_id:'compacted-tip-b'},scope)
  assert.equal(row(f,'root-b')[0],1); assert.equal(row(f,'compacted-tip-b'),null)
  f.event('message.delta',{text:'next'},scope); assert.equal(row(f,'root-b')[0],0)
  f.watch.flush(); const restored=fixture(f.saved()); assert.equal(row(restored,'root-b'),null) // future timestamps fail closed after clock rollback
})
test('sidebar exact warning and TTL boundaries and configured thresholds', () => {
  const f=fixture(); f.event('message.delta',{text:'a'}); f.advance(25*60000-1)
  assert.equal(row(f,'stored-a')[1],'fresh'); f.advance(1); assert.equal(row(f,'stored-a')[1],'warning')
  f.advance(5*60000); assert.equal(row(f,'stored-a')[1],'expired')
  f.watch.configure(60,50); assert.equal(row(f,'stored-a')[1],'fresh'); assert.equal(f.sends.length,0)
})
test('sidebar subscriptions are leaf-scoped, minute-stable and coalesce token bursts', () => {
  const f=fixture(); let a=0,b=0; const stop=f.watch.subscribeRow('stored-a',()=>a++); f.watch.subscribeRow('stored-b',()=>b++)
  f.event('message.delta',{text:'a'}); assert.equal(a,0); f.watch.tick(); assert.equal(a,1)
  for(let i=0;i<100;i++) { f.advance(10); f.event('message.delta',{text:'token'}) }
  f.watch.tick(); assert.equal(a,1); assert.equal(b,0)
  f.advance(60000); f.watch.tick(); assert.equal(a,2); assert.equal(b,0)
  stop(); f.advance(60000); f.watch.tick(); assert.equal(a,2)
  f.watch.dispose(); f.watch.tick(); assert.equal(b,0)
})
test('registration uses trailing data.render for both host row variants; native Tip and warning badge render', () => {
  const f=fixture(); f.register(); assert.equal(f.contributions.length,2)
  const c=f.contributions.find(c=>c.id==='session-age'); assert.equal(c.area,'sessionRow.trailing'); assert.equal(c.render,undefined)
  const empty=c.data.render({sessionId:'unknown'}); assert.equal(empty.type(empty.props),null)
  const badge=c.data.render({sessionId:'stored-a'})
  f.event('message.delta',{text:'a'}); f.advance(25*60000)
  const tree=badge.type({...badge.props,watch:f.watch}); assert.equal(tree.type,'Tip')
  assert.equal(tree.props.children.props.children,'≈25m ⚠'); assert.equal(tree.props.style.backgroundColor,'var(--ui-bg-elevated)')
  assert.match(tree.props.label,/szacunek/); assert.equal(tree.props.children.props.onClick,undefined)
  f.disposers.forEach(fn=>fn()); assert.equal(f.sends.length,0)
})
test('storage failure does not crash tracking or cause a paid request', () => {
  const f=fixture(); f.storage.set=()=>{throw Error('quota')}; f.event('message.delta',{text:'x'}); f.watch.flush(); assert.match(f.watch.view().notice,/zapisać/); assert.equal(f.sends.length,0)
})
test('unknown owner never falls back to ambient profile for readout or paid send', () => {
  for (const owner of [null, {}, { profile: 'default' }]) {
    const f=fixture(); f.event('message.delta',{text:'a'}); f.state.focusedSessionOwner.set(owner)
    assert.equal(f.watch.view().age,null); assert.equal(f.watch.send(),false); assert.equal(f.sends.length,0)
  }
  const f=fixture(); delete f.state.focusedSessionOwner; assert.equal(f.watch.send(),false)
})
test('empty legacy owner connection is not replaced with ambient remote connection', () => {
  const f=fixture(); f.state.connectionId.set('remote'); assert.equal(f.watch.send(),false)
})
test('registry-tagged local and remote connections match the real scoped SDK contract', () => {
  for (const connectionId of ['local','remote-main']) {
    const f=fixture(); f.state.connectionId.set(connectionId)
    f.state.focusedSessionOwner.set({connectionId,profile:'default'})
    f.event('message.delta',{text:'a'},{connectionId})
    assert.equal(f.watch.view().age,0); assert.equal(row(f,'stored-a')[2],connectionId)
    assert.equal(f.watch.send(),true); assert.equal(f.sends[0].id,'runtime-a')
  }
})
test('untagged legacy frames cannot invent a background owner on a remote connection', () => {
  const f=fixture(); f.state.connectionId.set('remote'); f.state.focusedSessionOwner.set({connectionId:'remote',profile:'default'})
  f.event('message.delta',{text:'x'},{profile:undefined,connectionId:undefined}); f.watch.flush()
  assert.equal(f.watch.view().age,null); assert.equal(f.writes(),0)
})
test('malformed saved entries do not prevent restoring later valid metadata', () => {
  const key=JSON.stringify(['','default','stored-a'])
  const f=fixture({ records:[null,{key,at:1800000000000}], sequences:[null] })
  assert.equal(f.watch.view().age,0)
})
test('retention expiry is consistent in status and row even without a new dirty write', () => {
  const f=fixture(); f.event('message.delta',{text:'x'}); f.watch.flush(); f.advance(8*86400000)
  assert.equal(f.watch.view().age,null); assert.equal(row(f,'stored-a'),null)
})
test('late configuration callback after disposal cannot mutate settings or write', () => {
  const f=fixture(); f.watch.dispose(); assert.equal(f.watch.configure(60,50),false)
  assert.equal(f.watch.view().settings.ttl,30); assert.equal(f.writes(),0)
})
test('host rollback of partial registration removes already acquired subscriptions', () => {
  const f=fixture(); f.state.profile.subscribe=()=>{throw Error('subscribe failed')}
  assert.throws(()=>f.register(),/subscribe failed/); f.disposers.forEach(fn=>fn())
  assert.equal(f.listeners.size,0); assert.equal(f.timers.size,0)
  for (const a of Object.values(f.state)) assert.equal(a.listeners.size,0)
})
test('disk module imports only the public SDK and host React singleton', () => {
  const imports=[...source.matchAll(/^import .* from '([^']+)'/gm)].map(m=>m[1])
  assert.deepEqual(imports,['@hermes/plugin-sdk','react','react/jsx-runtime'])
  assert.doesNotMatch(source,/host\.request\(|fetch\(|window\.hermesDesktop/)
})
test('manual dispatch notices follow the addressed session, not the newly focused chat', () => {
  const f=fixture(); f.watch.send(); assert.match(f.watch.view().notice,/Przekazano/)
  f.state.focusedSessionId.set('runtime-b'); f.state.focusedStoredSessionId.set('stored-b')
  assert.equal(f.watch.view().notice,'')
  f.state.focusedSessionId.set('runtime-a'); f.state.focusedStoredSessionId.set('stored-a')
  assert.match(f.watch.view().notice,/Przekazano/)
})
test('failed threshold persistence never reports saved and can be retried', () => {
  const f=fixture(), save=f.storage.set
  f.storage.set=()=>{throw Error('quota')}
  assert.equal(f.watch.configure(60,50),false)
  assert.match(f.watch.view().notice,/zapisać/)
  assert.doesNotMatch(f.watch.view().notice,/Zapisano/)
  f.storage.set=save
  assert.equal(f.watch.configure(60,50),true)
  assert.match(f.watch.view().notice,/Zapisano/)
  assert.equal(f.saved().settings.ttl,60)
})
