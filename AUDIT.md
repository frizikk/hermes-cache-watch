# Cache Watch audit

## Evidence and scope

Official sources fetched in full, not just a truncated web-extractor preview:

- https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk — disk delivery, public imports, lifecycle, state, composer, row slots, UI kit and security.
- https://hermes-agent.nousresearch.com/docs/developer-guide/plugins — separates native Desktop from Python/dashboard plugins; third-party extensions belong in standalone repositories.

The locally available Hermes source checkout reported HEAD `71d34bad1045610252eda02ee79549436896e784`. Source inspection supplements the live docs; it does not prove the running Desktop binary was built from that revision. No Hermes core source was modified.

Public contract checks (paths relative to Hermes source):

| Contract | Evidence |
| --- | --- |
| Supported imports | `apps/desktop/src/sdk/index.ts`: exported host, atom/useValue, UI kit and row-area constant; React and jsx-runtime are the documented host singletons. No app-internal imports, bridge/DOM access, RPC, or private store imports. |
| Focus ownership | `apps/desktop/src/sdk/index.ts`: `focusedSessionOwner` is connection-qualified and returns null when ownership is ambiguous/unresolved. `connectionId` is a readonly public state atom. These newer exports are more specific than the live docs' abbreviated state list. |
| Manual sending | `apps/desktop/src/sdk/composer.ts`: `submit(sessionId, text): boolean`, exact visible composer or false. Acknowledgment is not gateway/model success. |
| Events | `apps/shared/src/gateway-events.ts` and `gateway-contract.generated.ts`: profile/connection/replay/sequence envelope, text-bearing stream payloads, usage and completion events. No authoritative cache expiry timestamp is used. |
| Lifecycle/storage | `apps/desktop/src/contrib/plugin.ts`: `onDispose`, scoped storage and registration rollback. All raw timers/listeners are explicitly owned by one early registered disposer. |
| Regular and pinned rows | `apps/desktop/src/lib/session-row-slots.ts` and `app/chat/sidebar/session-row.tsx`: both variants call the trailing slot with `sessionPinId(session)`; payload is `data.render({sessionId})`, not top-level render and not an owner-bearing row object. |
| Tooltip | `apps/desktop/src/components/ui/tooltip.tsx`: Tip forwards style/side props to TooltipContent. Plugin uses `--ui-bg-elevated`, theme text/stroke, opacity 1; no hardcoded colors. |

## Issues corrected

1. **Ambiguous owner could send:** the old target resolver fell back to the active profile/connection even when the authoritative owner was null. It now refuses manual sending and status age without a valid owner. Empty legacy connection IDs are preserved rather than replaced with the active remote connection.
2. **Legacy event misattribution:** profile-less frames received while focused on a nonlegacy connection could manufacture empty-connection records. Acceptance now requires the frame's connection to match the known focused/active owner as well as its runtime ID.
3. **Partial registration leaks:** cleanup used to be registered after event subscriptions and timers. A subscription failure before that point leaked already acquired resources. Cleanup is registered first and incrementally owns each resource; tests exercise host rollback after a partial failure.
4. **Late settings mutation:** `configure` now refuses changes after disposal.
5. **Retention mismatch:** status age now expires after the same retention window as sidebar metadata, even if nothing new made storage dirty.
6. **Malformed metadata recovery:** null entries no longer abort restoration of subsequent valid entries.
7. **Nonportable packaging:** removed personal absolute paths; added a dependency-free Node installer, package scripts, ignore rules, bilingual guidance and publication caveats. No unnecessary Python plugin/backend was added.
8. **Cross-session dispatch feedback:** an accepted/error/refused send notice was global and remained visible after focusing another conversation. Dispatch notices are now scoped to the connection/profile/durable session; storage/settings notices remain global. A regression was reproduced before the fix.
9. **False configuration success return:** `configure` returned true even when storage threw. It now returns false on save failure, preserves the failure notice and active in-memory thresholds, and allows retry. A failing regression confirmed the original behavior; no false claim of durable storage is made.

## Preserved behavior

No timer, event or installer sends a prompt. Only an explicit keepalive button action invokes the normal composer. Busy/disconnected/foreign-owner/missing-API checks remain. The model's no-tools instruction is not a technical tool prohibition. Status is based on local observation receipt time, never a provider cache claim. Defaults remain 30-minute estimated TTL and 25-minute warning. Metadata is bounded and contains identifiers/timestamps/sequence watermarks/settings, not transcript text or secrets. Sidebar subscriptions are per-row and minute-stable; token bursts do not publish row changes.

## Verification and limits

- `npm test`: plugin VM tests plus real isolated installer CLI/filesystem tests. Tests exercise no paid requests.
- `npm run check`: syntax checks for all six JavaScript files, including the optional host harness.
- Installer tests cover `HERMES_HOME`, explicit overwrite/backups, unrelated plugin/config preservation, symlink rejection, managed-copy/unrelated-folder refusal, non-file targets and unknown CLI flags.
- VM tests strip imports and mock React/SDK: they are logic/shape tests, **not** real React mounting, host ESM resolution, UI screenshots or end-to-end composer tests. Actual source contracts were inspected separately.
- `HERMES_SOURCE=/absolute/path/to/hermes-agent npm run test:host` adds two real-SDK/React jsdom tests: unchanged plugin imports; registration/disposal; opening the actual popover; submitting thresholds through the actual Input/Button form; disabled manual-send control; unknown row and observed badge mounting through the real Tip and React external-store hook. Only test state/storage and browser geometry APIs are substituted; no SDK/React module mocks and no real prompt. The harness uses existing host dependencies, resolves official host aliases including shared sources, runs outside core, and deletes its own sandbox. This passed against the local source installation; it does not prove native Electron loader compatibility or visual geometry.
- `.github/workflows/ci.yml` provides read-only Node 20/22 tests/check, no dependency install. Full action pins were retrieved using `git ls-remote` from `https://github.com/actions/checkout.git` tag `v4.2.2` (`11bd71901bbe5b1630ceea73d27597364c9af683`) and `https://github.com/actions/setup-node.git` tag `v4.4.0` (`49933ea5288caeca8642d1e84afbd3f7d6820020`). This is verified pin provenance, not a claim that remote CI has executed.
- The running UI was not revalidated during this audit. No app restart and no real keepalive was performed. Validate tooltip appearance, regular/pinned badges, toggling/hot reload and composer handling in the intended build before release.
- Ownerless row props cannot distinguish a never-observed duplicate durable ID on another source. Known collisions hide badges, but bounded metadata may eventually forget them. No claim of perfect cross-source sidebar attribution is made.
- Provider cache state/expiry/hit rate cannot be determined from these observations. Reconnect gaps, latency, old hosts without replay metadata and unknown compaction lineage mappings remain limitations.
- The original local-only audit preceded publication. The rights holder subsequently approved public repository `frizikk/hermes-cache-watch`, MIT licensing and attribution. Native visual validation remains outstanding; publication is experimental.
