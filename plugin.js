import { host, atom, useValue, Button, Input, Popover, PopoverTrigger, PopoverContent, Tip, SESSION_ROW_AREAS } from '@hermes/plugin-sdk'
import { useSyncExternalStore, useCallback } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

// No backend, auxiliary model, automatic prompt or transcript persistence.
export const KEEPALIVE = 'Krótki sygnał podtrzymania tej rozmowy. Odpowiedz tylko „OK”, bez narzędzi i bez wykonywania dodatkowych zadań.'
const MAX = 128
const RETAIN = 7 * 86400000
const keyOf = (connection, profile, id) => JSON.stringify([connection || '', profile, id])
const validId = value => typeof value === 'string' && value.length > 0 && value.length < 512
export function createWatch({ host, storage, now = Date.now, changed = () => {} }) {
  let disposed = false, dirty = false, notice = '', noticeKey = null, pending = null
  const records = new Map(), aliases = new Map(), sequences = new Map(), calls = new Map(), running = new Map()
  let settings = { ttl: 30, warning: 25 }
  try {
    const saved = storage.get('metadata-v1', null)
    if (saved?.settings && validSettings(saved.settings.ttl, saved.settings.warning)) settings = saved.settings
    for (const row of (Array.isArray(saved?.records) ? saved.records : []).slice(0, MAX)) {
      if (row && typeof row.key === 'string' && row.key.length < 1800 && Number.isFinite(row.at) && row.at <= now() && row.at > now() - RETAIN) records.set(row.key, row.at)
    }
    for (const row of (Array.isArray(saved?.sequences) ? saved.sequences : []).slice(0, MAX)) {
      if (row && typeof row.key === 'string' && row.key.length < 1800 && Number.isInteger(row.seq) && row.seq >= 0) sequences.set(row.key, row.seq)
    }
  } catch { notice = 'Nie udało się odczytać lokalnych metadanych.' }
  function bounded(map) { while (map.size > MAX) map.delete(map.keys().next().value) }
  function target() {
    const s = host.state, id = (s.focusedSessionId || s.activeSessionId).get()
    const owner = s.focusedSessionOwner?.get()
    const owned = validId(owner?.profile) && typeof owner?.connectionId === 'string'
    return { id, owned, stored: s.focusedStoredSessionId?.get() || id, profile: owned ? owner.profile : null, connection: owned ? owner.connectionId : null }
  }
  function targetKey(t) { return keyOf(t.connection, t.profile, t.stored) }
  // The row SDK exposes only a durable ID, not an owner or the session list.
  // Never select the ambient profile to break an ownership tie.
  const rowListeners = new Map()
  function rowSnapshot(sessionId) {
    if (disposed || !validId(sessionId)) return ''
    const owners = new Set()
    for (const key of records.keys()) {
      try {
        const parts = JSON.parse(key)
        if (Array.isArray(parts) && parts.length === 3 && parts[2] === sessionId && typeof parts[0] === 'string' && validId(parts[1])) owners.add(key)
      } catch { /* Ignore malformed legacy storage. */ }
    }
    for (const [key, stored] of aliases) {
      if (stored !== sessionId) continue
      const [connection, profile] = JSON.parse(key)
      owners.add(keyOf(connection, profile, stored))
    }
    if (host.state.focusedStoredSessionId?.get() === sessionId) {
      const owner = host.state.focusedSessionOwner?.get()
      if (!owner || !validId(owner.profile) || typeof owner.connectionId !== 'string') return ''
      owners.add(keyOf(owner.connectionId, owner.profile, sessionId))
    }
    if (owners.size !== 1) return ''
    const key = [...owners][0], at = records.get(key)
    if (!Number.isFinite(at) || at > now() || at < now() - RETAIN) return ''
    const age = now() - at
    const level = age >= settings.ttl * 60000 ? 'expired' : age >= settings.warning * 60000 ? 'warning' : 'fresh'
    return JSON.stringify([Math.floor(age / 60000), level, ...JSON.parse(key).slice(0, 2)])
  }
  function subscribeRow(sessionId, listener) {
    if (disposed) return () => {}
    let row = rowListeners.get(sessionId)
    if (!row) { row = { snapshot: rowSnapshot(sessionId), listeners: new Set() }; rowListeners.set(sessionId, row) }
    row.listeners.add(listener)
    return () => { row.listeners.delete(listener); if (!row.listeners.size) rowListeners.delete(sessionId) }
  }
  function publishRows() {
    if (disposed) return
    for (const [id, row] of rowListeners) {
      const next = rowSnapshot(id)
      if (row.snapshot !== next) { row.snapshot = next; row.listeners.forEach(fn => fn()) }
    }
  }
  function publish() { if (!disposed) changed() }
  function record(key) {
    records.delete(key); records.set(key, now()); bounded(records); dirty = true
  }
  function handle(event) {
    if (disposed || !validId(event?.session_id) || event.replayed) return
    const t = target(), sid = event.session_id, p = event.payload || {}
    // Untagged legacy events are attributable only to the focused ambient session.
    if (!event.profile && (!t.owned || sid !== t.id || t.profile !== host.state.profile.get() || t.connection !== (event.connectionId || '') || t.connection !== (host.state.connectionId?.get() || ''))) return
    const profile = event.profile || t.profile, connection = event.connectionId || ''
    if (!validId(profile)) return
    const runtimeKey = keyOf(connection, profile, sid)
    if (Number.isInteger(event.seq)) {
      const seqKey = keyOf(connection, profile, `${sid}:${event.replayEpoch || 'legacy'}`)
      if ((sequences.get(seqKey) ?? -1) >= event.seq) return
      sequences.delete(seqKey); sequences.set(seqKey, event.seq); bounded(sequences); dirty = true
    }
    let stored = aliases.get(runtimeKey) || (sid === t.id && profile === t.profile && connection === t.connection ? t.stored : sid)
    if (event.type === 'session.info' && validId(p.stored_session_id)) {
      const previousKey = keyOf(connection, profile, stored)
      // Once bound, keep the durable root when compaction rotates the stored tip.
      stored = aliases.get(runtimeKey) || (sid === t.id && profile === t.profile && connection === t.connection && validId(t.stored) && t.stored !== sid ? t.stored : p.stored_session_id)
      const nextKey = keyOf(connection, profile, stored)
      if (records.has(previousKey) && previousKey !== nextKey) {
        records.set(nextKey, Math.max(records.get(previousKey), records.get(nextKey) || 0)); records.delete(previousKey); dirty = true
      }
      aliases.set(runtimeKey, stored); bounded(aliases)
    }
    const key = keyOf(connection, profile, stored)
    const usage = p.usage
    const count = usage?.calls
    // A usage snapshot isn't an LLM timestamp. Only an observed increase is evidence.
    const increased = Number.isFinite(count) && calls.has(runtimeKey) && count > calls.get(runtimeKey)
    if (Number.isFinite(count)) { calls.set(runtimeKey, count); bounded(calls) }
    if (event.type === 'session.info' && typeof p.running === 'boolean') running.set(runtimeKey, p.running)
    if (event.type === 'message.start') running.set(runtimeKey, true)
    const completedResponse = event.type === 'message.complete' && running.get(runtimeKey) === true && p.status === 'complete' && typeof p.text === 'string' && p.text.length > 0 && Number.isFinite(count) && count > 0
    if (event.type === 'message.complete' || event.type === 'session.reclaimed') {
      running.set(runtimeKey, false)
      if (pending?.key === key) pending = null
    }
    // Tool execution, user input, lifecycle/error and repeated usage ticks do not reset time.
    const output = ['message.delta', 'reasoning.delta', 'thinking.delta', 'reasoning.available'].includes(event.type) && typeof p.text === 'string' && p.text.length > 0
    if (output || event.type === 'tool.generating' || completedResponse || (increased && ['session.usage', 'message.complete'].includes(event.type))) record(key)
    if (event.type === 'error' && pending?.key === key) {
      pending = null; noticeKey = key; notice = 'Czat zgłosił błąd. Nie ponawiam automatycznie; sprawdź rozmowę.'
    }
    bounded(running); publish()
  }
  function view() {
    const t = target(), key = targetKey(t), at = t.owned ? records.get(key) ?? null : null
    const runtimeKey = keyOf(t.connection, t.profile, t.id)
    const busy = Boolean(host.state.busy?.get() || host.state.awaitingResponse?.get() || host.state.busyBySession?.get()?.[t.id] || running.get(runtimeKey))
    const locked = pending?.key === key && now() - pending.at < 30000
    const age = at === null || at > now() || at < now() - RETAIN ? null : Math.max(0, now() - at)
    let reason = ''
    if (disposed) reason = 'Wtyczka wyłączona'
    else if (!validId(t.id)) reason = 'Otwórz istniejącą rozmowę'
    else if (!t.owned) reason = 'Nieznany lub niejednoznaczny właściciel rozmowy'
    else if (host.state.gateway.get() !== 'open') reason = 'Brak połączenia z bramą'
    else if (t.profile !== host.state.profile.get() || t.connection !== (host.state.connectionId?.get() || '')) reason = 'Najpierw aktywuj bramę tej rozmowy'
    else if (!host.state.busy || !host.composer?.submit) reason = 'Ta wersja Desktop nie udostępnia bezpiecznego wysyłania'
    else if (busy) reason = 'Agent pracuje — poczekaj'
    else if (locked) reason = 'Przekazano do czatu — poczekaj na reakcję'
    return { ...t, at, age, busy, reason, notice: noticeKey === null || noticeKey === key ? notice : '', settings, level: age === null ? 'unknown' : age >= settings.ttl * 60000 ? 'expired' : age >= settings.warning * 60000 ? 'warning' : 'fresh' }
  }
  function send() {
    const v = view()
    noticeKey = targetKey(v)
    if (v.reason) { notice = v.reason; publish(); return false }
    // Synchronous capture + exact-address dispatch: no async gap to change targets.
    pending = { key: targetKey(v), at: now() }
    try {
      const accepted = host.composer.submit(v.id, KEEPALIVE)
      if (!accepted) { pending = null; notice = 'Brak widocznego edytora tej sesji. Otwórz rozmowę i spróbuj ponownie.' }
      else notice = 'Przekazano do zwykłego czatu. To nie potwierdza odświeżenia cache; wynik zobaczysz w rozmowie.'
      publish(); return accepted
    } catch {
      // No automatic retry: transport/host failure can be ambiguous.
      notice = 'Nie potwierdzono wysłania. Sprawdź rozmowę przed kolejną próbą.'
      publish(); return false
    }
  }
  function configure(ttl, warning) {
    if (disposed) return false
    noticeKey = null
    if (!validSettings(ttl, warning)) { notice = 'Podaj pełne minuty: TTL 2–1440, ostrzeżenie co najmniej 1 i mniejsze niż TTL.'; publish(); return false }
    settings = { ttl, warning }; dirty = true; flush()
    if (!dirty) notice = 'Zapisano progi szacunkowe.'
    publish(); return !dirty
  }
  function flush() {
    if (!dirty || disposed) return
    for (const [key, at] of records) if (at < now() - RETAIN || at > now()) records.delete(key)
    try {
      storage.set('metadata-v1', { settings, records: [...records].map(([key, at]) => ({ key, at })), sequences: [...sequences].map(([key, seq]) => ({ key, seq })) })
      dirty = false
    } catch { noticeKey = null; notice = 'Nie udało się zapisać lokalnych metadanych.' }
  }
  return { handle, view, send, configure, flush, rowSnapshot, subscribeRow, tick() { publish(); publishRows() }, dispose() { flush(); disposed = true; pending = null; aliases.clear(); running.clear(); calls.clear(); rowListeners.clear() } }
}
function validSettings(ttl, warning) { return Number.isInteger(ttl) && ttl >= 2 && ttl <= 1440 && Number.isInteger(warning) && warning >= 1 && warning < ttl }
function elapsed(ms) { return `${Math.floor(ms / 60000)} min ${Math.floor(ms / 1000) % 60} s` }
function label(v) {
  if (!v.id) return 'Cache: brak sesji'
  if (v.busy) return 'Cache: agent pracuje'
  if (v.age === null) return 'Cache: czas nieznany'
  return `Cache ≈ ${elapsed(v.age)}${v.level === 'expired' ? ' · po TTL' : v.level === 'warning' ? ' · uwaga' : ''}`
}
function WatchUI({ watch, revision }) {
  useValue(revision)
  const v = watch.view()
  return jsxs(Popover, { children: [
    jsx(PopoverTrigger, { asChild: true, children: jsx('button', { type: 'button', 'aria-label': 'Cache Watch — szacowany czas bezczynności', title: 'Szacunek od ostatniej zaobserwowanej odpowiedzi LLM. Kliknij, aby otworzyć panel.', style: { padding: '0 8px', fontSize: '11px', color: v.level === 'fresh' ? 'var(--ui-text-secondary)' : 'var(--ui-accent)' }, children: label(v) }) }),
    jsx(PopoverContent, { side: 'top', align: 'end', style: { width: '360px', maxWidth: '90vw' }, children: jsxs('div', { style: { display: 'grid', gap: '10px', color: 'var(--ui-text-secondary)', fontSize: '13px' }, children: [
      jsx('strong', { children: 'Cache Watch · tylko szacunek' }),
      jsx('div', { children: label(v) }),
      jsx('div', { style: { overflowWrap: 'anywhere', fontSize: '11px' }, children: `Profil: ${v.profile} · sesja: ${v.stored || 'brak'}` }),
      jsx('div', { children: v.at ? `Ostatnia obserwacja: ${new Date(v.at).toLocaleTimeString('pl-PL')}` : 'Brak wiarygodnego czasu. Czekam na zaobserwowane wyjście modelu lub wzrost liczby wywołań.' }),
      jsx('div', { children: 'TTL nie jest odczytem cache Codex. Dostawca może usunąć cache wcześniej. Brak gwarancji trafienia, odświeżenia lub oszczędności.' }),
      jsx('form', { onSubmit: event => { event.preventDefault(); const data = new FormData(event.currentTarget); watch.configure(Number(data.get('ttl')), Number(data.get('warning'))) }, children: jsxs('div', { style: { display: 'grid', gap: '6px' }, children: [
        jsxs('label', { children: ['Szacowany TTL (min)', jsx(Input, { name: 'ttl', type: 'number', min: 2, max: 1440, step: 1, defaultValue: v.settings.ttl, required: true })] }),
        jsxs('label', { children: ['Ostrzeżenie po (min)', jsx(Input, { name: 'warning', type: 'number', min: 1, max: 1439, step: 1, defaultValue: v.settings.warning, required: true })] }),
        jsx(Button, { type: 'submit', variant: 'secondary', children: 'Zapisz progi' })
      ] }) }),
      jsx('div', { children: 'Kliknięcie wyśle zwykłą wiadomość w tej samej sesji, zużywa limit/tokeny i może kosztować. Nic nie wysyła się automatycznie.' }),
      jsxs('details', { children: [jsx('summary', { children: 'Treść wiadomości' }), jsx('p', { children: KEEPALIVE })] }),
      jsx(Button, { type: 'button', disabled: Boolean(v.reason), onClick: () => watch.send(), children: 'Wyślij keepalive (możliwy koszt)' }),
      v.reason && jsx('div', { role: 'status', children: v.reason }),
      v.notice && jsx('div', { role: 'status', children: v.notice }),
      jsx('small', { children: 'Licznik oparty na zdarzeniach Desktop, nie na telemetrii cache. Po rozłączeniu lub wyłączeniu obserwacje mogą być niepełne.' })
    ] }) })
  ] })
}
function SessionAge({ watch, sessionId }) {
  const subscribe = useCallback(fn => watch.subscribeRow(sessionId, fn), [watch, sessionId])
  const snapshot = useCallback(() => watch.rowSnapshot(sessionId), [watch, sessionId])
  const value = useSyncExternalStore(subscribe, snapshot, snapshot)
  if (!value) return null
  const [minutes, level, connection, profile] = JSON.parse(value)
  const text = `≈${minutes}m${level === 'fresh' ? '' : ' ⚠'}`
  const description = `Cache Watch: około ${minutes} min od zaobserwowanego wyjścia LLM.${level === 'expired' ? ' Po szacowanym TTL.' : level === 'warning' ? ' Próg ostrzeżenia.' : ''} Profil: ${profile}; źródło: ${connection || 'legacy'}. To szacunek, nie odczyt cache. Nic nie wysyła się automatycznie.`
  return jsx(Tip, { label: description, side: 'right', style: { maxWidth: '300px', backgroundColor: 'var(--ui-bg-elevated)', color: 'var(--ui-text-primary)', border: '1px solid var(--ui-stroke-secondary)', opacity: 1 }, children: jsx('span', {
    'aria-label': description,
    style: { flexShrink: 0, whiteSpace: 'nowrap', fontSize: '10px', fontVariantNumeric: 'tabular-nums', lineHeight: '16px', color: level === 'fresh' ? 'var(--ui-text-tertiary)' : 'var(--ui-accent)' },
    children: text
  }) })
}
export default {
  id: 'cache-watch', name: 'Cache Watch', description: 'Szacowany czas bezczynności LLM i ręczny keepalive; bez automatycznych zapytań.', defaultEnabled: true,
  register(ctx) {
    if (typeof ctx.onDispose !== 'function') throw new Error('Cache Watch wymaga SDK z onDispose.')
    const revision = atom(0)
    const watch = createWatch({ host, storage: ctx.storage, changed: () => revision.set(revision.get() + 1) })
    // Attach cleanup before acquiring resources: failed registration is rolled back too.
    const cleanups = []
    ctx.onDispose(() => { cleanups.forEach(stop => stop()); watch.dispose() })
    cleanups.push(host.onEvent('*', event => watch.handle(event)))
    const stateKeys = ['activeSessionId', 'focusedSessionId', 'focusedStoredSessionId', 'focusedSessionOwner', 'profile', 'connectionId', 'gateway', 'busy', 'awaitingResponse', 'busyBySession']
    for (const a of new Set(stateKeys.map(key => host.state[key]))) {
      if (typeof a?.subscribe === 'function') cleanups.push(a.subscribe(() => watch.tick()))
    }
    const clock = setInterval(() => watch.tick(), 1000)
    cleanups.push(() => clearInterval(clock))
    const persist = setInterval(() => watch.flush(), 5000)
    cleanups.push(() => clearInterval(persist))
    ctx.register({ id: 'status', area: 'statusBar.right', order: 125, render: () => jsx(WatchUI, { watch, revision }) })
    ctx.register({ id: 'session-age', area: SESSION_ROW_AREAS.trailing, order: 125, data: { render: ({ sessionId }) => jsx(SessionAge, { watch, sessionId }) } })
  }
}
