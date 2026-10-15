# Changelog

## Unreleased — 0.1.0 local candidate

- Observed LLM activity timer in the status bar and regular/pinned sidebar rows.
- Explicit, potentially billable keepalive through the ordinary visible composer;
  no automatic sends or retries and no claim of provider cache access or savings.
- Owner-qualified metadata, replay filtering, bounded retention and lifecycle cleanup.
- Dependency-free installer with explicit replacement, backups and byte verification.
- Scope manual-send feedback to its addressed conversation instead of showing it
  after focus changes. Report threshold persistence failure through the return value;
  keep the in-memory thresholds and permit a later save retry.
- Add Node 20/22 CI, regression coverage and an optional real React/SDK jsdom smoke
  using an existing Hermes source installation, without adding dependencies to this repo.

Not a published release. No license has been selected; no distribution permission
is inferred. Native visual/composer smoke and rights-holder approval remain required.
See [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).
