# Cache Watch — Hermes Desktop

Desktop-only plugin: observed LLM activity age in the status bar and regular/pinned sidebar rows, with an **explicit manual** keepalive button. No Python backend, dependencies, build step, polling, or automatic paid requests. UI and keepalive text are currently Polish; English setup and safety notes follow.

## Install / update

Requires Hermes **native Desktop** with `SESSION_ROW_AREAS`, `ctx.onDispose`, focused-owner state and `host.composer.submit`. This is not a web-dashboard or Python plugin. Compatibility is capability-based; no minimum released Hermes version has been established. Use Node.js 20+ for the installer and tests. No `npm install` is needed.

From this checkout:

```sh
npm test
npm run check
npm run install:plugin
# Update an existing Cache Watch installation, after reviewing it:
npm run install:plugin -- --replace
# Optional explicit app root:
HERMES_HOME=/absolute/path/to/hermes-home node install.mjs --replace
```

Default destination: `$HERMES_HOME/desktop-plugins/cache-watch`, or `~/.hermes/desktop-plugins/cache-watch` when unset. The official SDK treats Desktop plugins as **app-level**, shared across profiles/connections in that window; changing the selected chat profile does not select an install root. Set `HERMES_HOME` to the root actually used by Desktop, not an arbitrary profile directory.

The installer copies only `plugin.js`, `test.mjs`, and this README. It refuses overwrite without `--replace`, symlink paths, managed unified-package copies, unrelated nonempty folders, and non-file destinations. Replacement backs up the previous managed files under `$HERMES_HOME/cache/cache-watch-backups/install-*`, preserves extra files, stages each file and renames the entry point last, then checks byte equality. No config, other plugin, enable toggle, credentials, or other profile is modified. Per-file replacement is atomic, not a transaction across all files; backups permit recovery after an I/O failure. This local-user installer is not a defense against concurrent hostile filesystem changes.

Desktop normally hot-reloads saves. If needed, use the command palette → **Reload desktop plugins**. Enable/disable Cache Watch in the Plugins page (Settings or Capabilities, depending on the build). An existing disabled choice stays disabled. No automatic uninstaller is supplied: disable in Desktop; if removing files manually, inspect the exact folder and preserve any unrelated files and backups. Local metadata is retained on disable.

## Meaning and limitations (English)

- `≈12m` means time since a locally received model-output signal, **not cache age, a cache hit, provider TTL, or guaranteed savings**. Default thresholds: warning at 25 minutes, estimated TTL at 30; these are user assumptions, not Codex guarantees.
- The popover's **Wyślij keepalive (możliwy koszt)** button sends an ordinary visible message to the focused session through the host composer. It can cost money, consume quota and change conversation context. The Polish message asks for only “OK” with no tools; this is a request, not enforcement. Nothing sends automatically or retries automatically. A true composer return only means a visible composer claimed the message, not that a model call or cache refresh succeeded.
- Unknown/ambiguous focused ownership blocks sending and hides the status age. Busy, disconnected, foreign-owner and unavailable composer cases also block sending. Reads are scoped by connection, profile and session. No transcripts or credentials are persisted; identifiers are local metadata and may still be sensitive.
- Sidebar SDK props contain only the durable lineage-root ID, not its owner. Known owner collisions hide the badge. **Unobserved ID collisions in another source cannot be detected**, and bounded history can forget a previously seen collision. Do not treat badges as authoritative cross-source attribution. An unknown tip-to-root mapping may leave a row without a badge.
- Receipt time can lag the model call; replayed frames and duplicate sequence numbers are ignored, but old hosts without replay/sequence metadata cannot reliably deduplicate events. Activity while disabled/disconnected is not reconstructed.
- The native themed tooltip uses an opaque background token. An optional real React/SDK jsdom smoke now checks imports and mounting; actual appearance, Electron disk-loader resolution and composer behavior still need validation in the target Desktop build.

## Development and publication

`npm test` runs the VM-based plugin tests and an isolated filesystem/CLI installer suite; `npm run check` parses all JavaScript. No test contacts an LLM. Installer tests create and remove only their own temporary sandboxes (`TMPDIR` can choose their parent). The VM removes ESM imports and mocks SDK/React contracts, so passing it alone does **not** establish runtime SDK availability or real React rendering. Public contracts and actual SDK source were separately inspected; see [AUDIT.md](AUDIT.md) in the repository.

An optional integration smoke exercises the **unchanged ESM imports**, real SDK exports, host React, Popover/Input/Button, Tip and the external-store row hook under jsdom:

```sh
HERMES_SOURCE=/absolute/path/to/hermes-agent npm run test:host
```

It requires that checkout's already-installed Desktop test dependencies; it installs nothing and modifies no host source. It creates/removes only its own temporary harness, using the host's jsdom setup and Vite aliases. The settings form is submitted to in-memory storage; the keepalive button is never clicked. This is not native Electron, a screenshot/geometry test, a disk-loader test or a real composer send. Host source changes can require harness updates. UI and keepalive remain Polish; no broad localization is claimed.

The GitHub Actions workflow runs the dependency-free tests/check on Node 20 and 22, using full action commit pins verified from official upstream tag refs. It has not run remotely while this repository has no remote. See [CHANGELOG.md](CHANGELOG.md) and the outstanding [release checklist](RELEASE_CHECKLIST.md).

This is a standalone local Git repository, intentionally uncommitted and without a remote. No license or authorship grant is inferred. **Before public distribution, the rights holder must choose a license and approve attribution.** `package.json` is private to prevent accidental npm publication. There is deliberately no Python manifest, backend stub, or claim of compatibility with `hermes plugins install`; distribution uses the documented Desktop disk door.

Authoritative references:
- [Desktop Plugin SDK](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk)
- [Plugin development/distribution guide](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins)

## Dokumentacja polska

Wtyczka dyskowa w `$HERMES_HOME/desktop-plugins/cache-watch` (domyślnie `~/.hermes/desktop-plugins/cache-watch`).
Bez zmian w rdzeniu, bez Python backendu, bez dodatkowych połączeń do LLM.

## Obsługa

- Przy sesjach w panelu bocznym (zwykłych i przypiętych) pojawia się osobny licznik **≈12m**. Po progu ostrzeżenia: **≈25m ⚠**. Najechanie pokazuje natywny tooltip z nieprzezroczystym tłem motywu, profilem i źródłem obserwacji. To tylko dekoracja — kliknięcie nie wysyła niczego i nie zmienia obsługi wiersza.
- Nieznany czas lub niejednoznaczny właściciel oznacza brak badge, nie „0 minut”. Każdy licznik dotyczy własnej sesji, niezależnie od aktualnie otwartej rozmowy.
- W prawym pasku stanu kliknij **Cache ≈ …** / **Cache: czas nieznany**. Otwiera się mały panel, bez opuszczania rozmowy.
- Domyślnie TTL to **30 minut**, ostrzeżenie po **25 minutach**. Formularz zapisuje całkowite minuty (TTL 2–1440; ostrzeżenie mniejsze od TTL).
- **Wyślij keepalive (możliwy koszt)** przekazuje jedną zwykłą, widoczną wiadomość do edytora dokładnie wskazanej sesji. Nie tworzy nowej sesji ani osobnego wywołania LLM. Przycisk nie jest dostępny podczas pracy agenta, bez połączenia, na nowym pustym czacie ani gdy właściciel sesji nie odpowiada aktywnej bramie.
- Wiadomość: `Krótki sygnał podtrzymania tej rozmowy. Odpowiedz tylko „OK”, bez narzędzi i bez wykonywania dodatkowych zadań.` To prośba dla modelu, nie techniczne wyłączenie narzędzi.
- To normalna interakcja: może kosztować, zużywa limit/tokeny i dopisuje kontekst. Nie gwarantuje odświeżenia cache, cache hit ani oszczędności. **Żaden timer ani zdarzenie nie wysyła wiadomości.**
- Wyłączanie: Ustawienia → Plugins → Cache Watch. Po ponownym włączeniu przywracane są wyłącznie lokalne metadane.
- Desktop powinien automatycznie wykryć plik. W razie potrzeby paleta poleceń → **Reload desktop plugins**. Nie zmieniaj zapamiętanego wyłączenia użytkownika.

## Co naprawdę mierzy licznik

To czas od ostatniego **zaobserwowanego sygnału odpowiedzi LLM w Desktop**, nie odczyt serwera cache:

- niepuste `message.delta`, `reasoning.delta`, `thinking.delta`, `reasoning.available`;
- `tool.generating` (model emituje argumenty, nie samo wykonanie narzędzia);
- wzrost `payload.usage.calls` w `session.usage` lub `message.complete` względem wcześniejszej obserwacji;
- zakończona odpowiedź bez streamingu: uprzednio zaobserwowane `message.start`/stan running, `message.complete` ze statusem `complete`, niepustym tekstem i dodatnią liczbą wywołań.

`message.start`, kliknięcie przycisku, ACK edytora, wykonywanie narzędzi, błędy, powtarzane ticki usage i `session.info` NIE odświeżają czasu. Ramki `replayed` są ignorowane. Duplikaty/starsze sekwencje są odrzucane w domenie `(connection, profile, runtime session, replayEpoch)`.

Gateway nie dostarcza czasu powstania tych zdarzeń, więc używany jest lokalny czas ich odbioru. Szczególnie completion/usage/reasoning.available mogą być opóźnione względem wywołania LLM. Jeśli strumień został pominięty albo brak dostatecznych danych, czas pozostaje nieznany. Nie da się rozpoznać duplikatu starego hosta bez `seq` i `replayed` bez ryzyka odrzucania prawdziwych powtórzonych tokenów.

Zbadane `tui_gateway/server.py::_session_info` udostępnia `running`, `turn_started_at`, `stored_session_id`, `usage`, `profile_name`, lecz **nie ma czasu ostatniego wywołania LLM**. `turn_started_at` i ogólny czas modyfikacji sesji nie zastępują go. Dlatego nie odczytujemy transkryptów ani nie przywracamy fikcyjnego czasu z historii: przywracamy własną obserwację po trwałym ID albo pokazujemy „nieznany”. Obserwacje z czasu wyłączenia/rozłączenia nie są odzyskiwane. Plugin nie odpytuje backendu cyklicznie.

## Faktycznie użyte kontrakty hosta

Źródła sprawdzone w repozytorium Hermes Agent (ścieżki względne):

- `apps/desktop/src/sdk/index.ts`: `host.state.focusedSessionId`, `focusedStoredSessionId`, `focusedSessionOwner`, `activeSessionId`, `profile`, `connectionId`, `gateway`, `busy`, `awaitingResponse`, `busyBySession`; reaktywne atomy tylko do odczytu.
- `apps/desktop/src/sdk/composer.ts`: **`host.composer.submit(runtimeSessionId, text): boolean`**. Dokładny adres sesji, fail-closed gdy nie ma widocznego edytora. To ścieżka zwykłego wysyłania, zamiast samodzielnego RPC.
- `apps/desktop/src/app/chat/composer/hooks/use-composer-submit.ts`: normalna obsługa z `dispatchSubmit` / `onSubmit`. Wynik `true` oznacza przejęcie przez widoczny edytor, **nie potwierdzenie RPC lub cache**. Błędy asynchroniczne obsługuje także zwykły czat. Nie ponawiamy automatycznie. Lokalna blokada wielokrotnego kliknięcia wynosi 30 sekund lub do końca tury; stan busy hosta nadal blokuje.
- Zbadano również `apps/shared/src/gateway-contract.generated.ts`: normalnym RPC jest `prompt.submit` z `session_id`, `profile`, `text`, `surface` itd. Plugin NIE wywołuje `llm.oneshot`, nie korzysta z wymyślonego `chat.send` i nie omija zwykłego edytora.
- `apps/shared/src/gateway-events.ts`: `host.onEvent('*', callback)` otrzymuje obiekt z `type`, `session_id`, `payload`, opcjonalnie `profile`, `connectionId`, `seq`, `replayEpoch`, `replayed`. Profile i połączenia są częścią klucza. Nietagowane zdarzenia legacy przypisujemy tylko do aktualnej sesji aktywnej bramy.
- `apps/desktop/src/contrib/plugin.ts`: `ctx.onDispose`, `ctx.storage.get/set`, `ctx.register`.
- `apps/desktop/src/lib/session-row-slots.ts` i `app/chat/sidebar/session-row.tsx`: `SESSION_ROW_AREAS.trailing`, **`data.render({ sessionId })`** — ta sama szczelina w zwykłych i przypiętych wierszach. ID to korzeń lineage (`store/session.ts::sessionPinId`), nie runtime ani nowy tip po kompakcji. Raz poznany alias runtime → trwałe ID pozostaje stabilny przy rotacji stored tip.
- SDK nie eksportuje pełnego reaktywnego `$sessions` ani właściciela w props wiersza (`host.sessions` udostępnia mutacje, nie listę). Badge wymaga jednego właściciela w znanych metadanych/aliasach; kolizja `(connection, profile)` ukrywa badge dla tego ID, także gdy drugi właściciel ma tylko `session.info`. Dla aktualnie otwartej sesji dodatkowo sprawdzany jest `focusedSessionOwner`, a `null` ukrywa badge. Aktywny profil nie rozstrzyga kolizji. **Ograniczenie SDK:** nie da się wykryć właściciela nigdy nieobserwowanego duplikatu ID w innym źródle; nie odpytujemy wszystkich bram. Nieznanego powiązania tip → korzeń również nie zgadujemy — taki korzeń nie dostanie badge do czasu poznania trwałego ID.
- ESM importuje tylko `@hermes/plugin-sdk`, `react` oraz `react/jsx-runtime`. Natywne `Tip`, `Popover`, `Button`, `Input`, kolory motywu `--ui-*`. Tooltip używa `--ui-bg-elevated` zamiast przezroczystego fill.

Dokumentacja: https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk

## Dane i cykl życia

Klucz storage: `hermes.plugin.cache-watch.metadata-v1`. Tylko progi, identyfikatory i znaczniki czasu oraz granice sekwencji; żadnych treści wiadomości, promptów, wyników narzędzi, kluczy API ani transkryptów. Maksymalnie 128 rekordów czasu i 128 granic sekwencji; czas starszy niż 7 dni jest usuwany przy zapisie. Mapy w pamięci też są ograniczone do 128 pozycji. Zapis co 5 sekund, przy zmianie progów i na wyłączeniu. Zegar UI co sekundę; oba timery tylko lokalne. Wyłączenie/hot reload usuwa listener zdarzeń, subskrypcje atomów i timery. Późne wywołania po dispose nie mutują danych ani nie wysyłają.

## Odświeżanie badge

Każdy zamontowany badge subskrybuje tylko własny trwały identyfikator przez `useSyncExternalStore`. Wspólny lokalny tick co sekundę porównuje snapshot `(pełne minuty, poziom, właściciel)`; tokeny nie publikują zmian do wierszy. Tylko zmiana snapshotu powiadamia dany badge, bez przebudowy całej listy. Brak dodatkowego timera na wiersz. Subskrypcje znikają przy odmontowaniu i wyłączeniu wtyczki. Pomijane są niezwiązane atomy hosta (np. viewport i usage).

## Testy bez płatnych zapytań

```sh
node --test test.mjs
node --check plugin.js
```

`test.mjs` wykonuje rzeczywisty moduł po usunięciu importów w izolowanym Node VM z atrapami SDK, zegara i edytora. Obejmuje progi, eventy, duplikaty/replay, różne sesje/profile/połączenia, brak połączenia/busy, ACK/błędy, metadane/reload, limity pamięci, cleanup oraz render drzewa panelu. Żaden test nie wysyła prawdziwego promptu. Osobna weryfikacja w uruchomionym Desktop jest potrzebna do potwierdzenia wyglądu i kompatybilności konkretnego buildu; wysłanie płatnego keepalive należy wyłącznie do użytkownika.
