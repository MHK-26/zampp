# zampp architecture

Plan written with the ECC planner/architect templates (see `.claude/agents/`).

## Overview

zampp is a local web stack manager: a Node.js daemon that provisions binaries, renders
configuration from templates, supervises services, and exposes a local REST + WebSocket
API consumed by a React control panel and a CLI. Everything it manages lives in
`~/.zampp` (override with `ZAMPP_HOME`), so the install is relocatable and removable.

```
 ┌──────────────┐   HTTP/WS (127.0.0.1:1980, token)   ┌──────────────────────────────┐
 │  ui/ (React) │ ───────────────────────────────────▶ │ src/server  (node:http + ws) │
 └──────────────┘                                       │   routes/*.ts  ws/logs       │
 ┌──────────────┐  in-process                           └──────────────┬───────────────┘
 │ bin/zampp.ts │ ─────────────────────────────────────────────────────▶│
 └──────────────┘                                                       ▼
                                             ┌───────────────────────────────────────┐
                                             │ src/core                               │
                                             │  paths · state · secrets · templates   │
                                             │  ports · hosts · tls · downloads       │
                                             │  supervisor (spawn, pid, health)       │
                                             │  services/ apache php-fpm mariadb      │
                                             │            mailpit adminer             │
                                             │  sites/ (vhost model → apache conf)    │
                                             └───────────────────────────────────────┘
                                                    ▼ renders / spawns
                           ~/.zampp/{bin,etc,logs,run,www,data,ssl,state.json,secrets.json}
```

## Requirements (from docs/research)

Must: one-command install/start; secure defaults; port conflict detection + re-port;
`.test` sites from UI/CLI; per-site PHP version; Mailpit wired to `mail()`; DB admin UI;
live logs; mkcert HTTPS; template-rendered configs. Should: doctor, project templates,
Nginx engine, Redis. Nice: menu-bar app, share links.

## Decisions (ADRs)

| # | Decision | Alternatives | Why |
|---|---|---|---|
| 1 | Node 26 + TypeScript with native type stripping, no build step for the daemon | tsc/tsx/esbuild build, Go, Rust | Zero toolchain for contributors; Node is already required. Constraint: erasable syntax only. |
| 2 | `node:http` + `ws`, no web framework | Hono, Fastify, Express | ~15 routes; a tiny router keeps deps at two runtime packages (`ws`, `zod`). |
| 3 | React + Vite for the panel, served as static files by the daemon | htmx, Svelte, Electron | Familiar, fast dev loop, no desktop runtime. A tray app can wrap the same URL later. |
| 4 | Apache httpd as default web engine, PHP via PHP-FPM over `mod_proxy_fcgi` | mod_php, Nginx, Caddy | XAMPP parity (`.htaccess` works) while enabling per-site PHP versions. macOS ships httpd 2.4 with proxy_fcgi/ssl/rewrite, so the default install needs no download. Nginx engine is a follow-up behind the same `WebEngine` interface. |
| 5 | PHP from static-php-cli FPM tarballs (dl.static-php.dev), Homebrew `php@x` auto-detected as extra versions | Homebrew only, compile | Verified 8.5.8 FPM build runs on this machine with mysqlnd, pdo_mysql, gd, zip, redis. No sudo, no brew, 15 MB per version. |
| 6 | MariaDB via Homebrew provider (MySQL tarball provider as fallback) | bundle, Docker | No official MariaDB macOS tarballs exist; brew is the only reliable source. Provider interface keeps the door open. |
| 7 | Mailpit binary from GitHub releases; PHP `sendmail_path` points at `mailpit sendmail` | mailhog, fake sendmail | Actively maintained, single binary, arm64 build, web UI + API. |
| 8 | Adminer single file by default; phpMyAdmin optional | phpMyAdmin only | Adminer 6.x works on PHP 8.5; phpMyAdmin 5.2.3 declares `<8.4`. |
| 9 | `.test` TLD through a managed block in `/etc/hosts`, written through a privileged helper (`osascript` admin prompt or `sudo`) | dnsmasq + /etc/resolver | No extra daemon; dnsmasq is an optional provider later (wildcards). Browsers also accept `*.localhost` as a no-sudo fallback. |
| 10 | Secure defaults: 127.0.0.1 binds, generated DB root password, API bearer token, secrets file mode 0600 | XAMPP-style open defaults | The number-one documented XAMPP complaint. |
| 11 | Supervisor owns children directly (spawned in foreground mode: `httpd -D FOREGROUND`, `php-fpm -F`, `mariadbd`, `mailpit`) with pid files and TCP/socket health probes | launchd/brew services, polling by process name | Deterministic start/stop, log capture, crash detection; the same approach FlyEnv converged on. Daemon restart re-adopts children via pid files. |
| 12 | State in `state.json` (sites, settings, installed versions), validated with zod on load | SQLite | Small, diffable, hand-editable. |

## Module map

```
bin/zampp.ts                 CLI entry (start, stop, status, doctor, ui, site, php, db, mail, logs)
src/core/paths.ts            ZAMPP_HOME layout, ensureDirs
src/core/state.ts            typed JSON store (zod) + atomic writes
src/core/secrets.ts          token + db password generation, 0600
src/core/templates.ts        tiny mustache-like renderer with escaping rules per format
src/core/ports.ts            isFree, findFree, listListeners (lsof -nP -iTCP -sTCP:LISTEN)
src/core/hosts.ts            managed block parse/render + privileged write
src/core/downloads.ts        fetch → verify size/sha → extract (tar) into bin/<name>/<version>
src/core/supervisor.ts       spawn/stop/restart, pid files, health probes, log files, events
src/core/services/*.ts       ServiceDefinition per service: apache, php-fpm, mariadb, mailpit
src/core/sites.ts            Site model, vhost rendering, docroot scaffolding, TLS per site
src/core/tls.ts              mkcert install + per-site certs
src/core/doctor.ts           environment checks with fixes
src/server/index.ts          http server, token auth, static UI, WS log tail
src/server/routes/*.ts       /api/v1/{status,services,sites,php,db,mail,ports,logs,settings,doctor}
templates/*.tpl              httpd.conf, vhost.conf, php-fpm.conf, php.ini, my.cnf, welcome page
ui/                          Vite + React panel
tests/                       node --test unit tests (pure modules) + e2e behind ZAMPP_E2E=1
```

## API (v1, all under `/api/v1`, bearer token)

| Method | Path | Purpose |
|---|---|---|
| GET | /status | daemon version, home, services summary, ports |
| GET | /services | list services with state, pid, ports, uptime, log files |
| POST | /services/:id/start · /stop · /restart | control |
| GET/PATCH | /services/:id/config | read/patch editable settings (port, version) → re-render + restart |
| GET/POST | /sites · GET/PATCH/DELETE /sites/:name | vhosts (name, root, php version, tls, aliases) |
| POST | /sites/:name/secure | issue mkcert cert + https vhost |
| GET | /php/versions · POST /php/versions (install) · DELETE /php/versions/:v | PHP versions |
| GET | /db/credentials | host, port, user, password, adminer URL |
| GET | /ports | listeners (pid, command, port) |
| GET | /logs · WS /ws/logs?file=… | log catalog and live tail |
| GET | /doctor · POST /doctor/fix/:id | diagnostics |
| GET/PATCH | /settings | tld, ports, autostart, theme |

Errors: `{ error: { code, message, details? } }` with proper status codes (api-design skill).

## Implementation phases

1. **Foundation** (paths, state, secrets, templates, ports, hosts) — pure, unit-tested.
2. **Supervisor + Apache + PHP-FPM** — serve `~/.zampp/www` on localhost with PHP.
3. **MariaDB + Mailpit + Adminer** — full stack, secrets wired in.
4. **Sites + TLS + hosts** — `name.test`, per-site PHP, https.
5. **API server + CLI** — all endpoints, doctor.
6. **React panel** — dashboard, services, sites, PHP, DB, mail, logs, ports, settings.
7. **Verification loop, docs, README, GitHub publish, final report.**

Risks: port 80/443 may be held by another stack (mitigated by detection + 8080/8443
fallback); hosts-file writes need an admin prompt (mitigated by `.localhost` fallback);
Homebrew MariaDB install is slow (mitigated by running it in the background with progress).
