# Release checklist

This is an **experimental MIT-licensed public repository**, not a stable release. Native Desktop validation below remains outstanding.

## Rights and packaging

- [x] Rights holder approved MIT licensing and attribution; see LICENSE.
- [ ] Review all files for private paths, identifiers, secrets and unintended content.
- [x] Public repository and distribution approved: `frizikk/hermes-cache-watch`. No stable release or tag is implied.
- [ ] Keep `private: true` unless a separate, intentional npm release is approved.
- [ ] Review CHANGELOG and supported host capabilities; do not invent a minimum version.

## Automated checks (no model requests)

- [ ] Run `npm test` and `npm run check` on Node 20 and 22; inspect actual CI results
      after a future approved push. A workflow file is not evidence that CI ran.
- [ ] Run `HERMES_SOURCE=/absolute/path/to/hermes-agent npm run test:host` with the
      target source checkout's existing dependencies. This imports the real SDK and
      mounts React under jsdom, but does not load a disk plugin in native Electron.
- [ ] Exercise a fresh isolated `HERMES_HOME` install and explicit `--replace`;
      inspect backups and byte equality, and confirm unrelated files are untouched.
- [ ] Review immutable action pins against official upstream tag refs before changing them.

## Native Desktop smoke — still required

- [ ] Load/disable/re-enable/hot-reload without an error toast or leaked timers.
- [ ] Inspect status popover, focus/keyboard behavior, narrow layout, and opaque
      tooltip in light/dark themes, for regular and pinned sidebar rows.
- [ ] Check fresh/warning/expired/unknown ages, switching sessions/profiles/connections,
      split tiles, reconnects and compaction lineage behavior.
- [ ] Confirm unknown/foreign ownership, busy and disconnected states block sending.
- [ ] Only with the user's separate cost consent, verify exact-session manual sending,
      existing draft behavior and asynchronous error feedback in the real composer.
      Automated tests must not send a real prompt.

## Claims that must remain explicit

- The timer is local receipt-based activity age, **not provider cache telemetry**.
- TTL/warning thresholds are assumptions, not a cache guarantee, refresh guarantee,
  cache-hit guarantee or savings promise. A normal keepalive may cost money.
- No auto-send, auto-retry, transcript persistence or Python backend.
- Ownerless row props cannot detect unobserved cross-source ID collisions. No badge
  is safer than guessing; known collisions fail closed, bounded history can forget them.
- UI and keepalive are currently Polish. Do not imply full locale support.
