// Executed only by host-smoke.mjs against the target checkout's installed packages.
import { test, expect } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { createElement, cloneElement } from 'react'
import { atom } from '@hermes/plugin-sdk'
import plugin, { createWatch } from 'cache-watch-plugin'

test('real SDK imports, React popover, settings and disposal without sending', () => {
  const contributions = [], disposers = [], saved = []
  plugin.register({ storage: { get: () => null, set: (...args) => saved.push(args) }, onDispose: fn => disposers.push(fn), register: c => contributions.push(c) })
  try {
    const ui = render(createElement(contributions.find(c => c.id === 'status').render))
    fireEvent.click(ui.getByRole('button', { name: 'Cache Watch — szacowany czas bezczynności' }))
    expect(ui.getByText('Cache Watch · tylko szacunek')).toBeTruthy()
    expect(ui.getByRole('button', { name: 'Wyślij keepalive (możliwy koszt)' }).disabled).toBe(true)
    fireEvent.change(ui.getByLabelText('Szacowany TTL (min)'), { target: { value: '60' } })
    fireEvent.click(ui.getByRole('button', { name: 'Zapisz progi' }))
    expect(saved.at(-1)[1].settings).toEqual({ ttl: 60, warning: 25 })
    expect(ui.getByText('Zapisano progi szacunkowe.')).toBeTruthy()
    const row = contributions.find(c => c.id === 'session-age')
    render(row.data.render({ sessionId: 'unknown' }))
  } finally { cleanup(); disposers.forEach(fn => fn()) }
})

test('real SDK Tip and React external-store hook mount an observed sidebar age', () => {
  const contributions = [], disposers = []
  plugin.register({ storage: { get: () => null, set() {} }, onDispose: fn => disposers.push(fn), register: c => contributions.push(c) })
  const state = Object.fromEntries(Object.entries({ focusedSessionId: 'runtime', focusedStoredSessionId: 'stored', focusedSessionOwner: { profile: 'default', connectionId: 'local' }, profile: 'default', connectionId: 'local' }).map(([k,v]) => [k,atom(v)]))
  const watch = createWatch({ host: { state }, storage: { get: () => null, set() {} }, now: () => 1800000000000 })
  try {
    watch.handle({ type: 'message.delta', session_id: 'runtime', profile: 'default', connectionId: 'local', payload: { text: 'observed' } })
    const row = contributions.find(c => c.id === 'session-age').data.render({ sessionId: 'stored' })
    const ui = render(cloneElement(row, { watch }))
    expect(ui.getByText('≈0m')).toBeTruthy()
    expect(ui.getByLabelText(/To szacunek, nie odczyt cache/)).toBeTruthy()
  } finally { cleanup(); watch.dispose(); disposers.forEach(fn => fn()) }
})
