# Contributing to zampp

Thanks for helping make the open-source XAMPP better.

## Setup

```bash
git clone https://github.com/MHK-26/zampp && cd zampp
npm install && npm --prefix ui install
npm test                 # unit + API tests (no services are started)
npm run typecheck
npm run dev              # API on 127.0.0.1:1980
npm run dev:ui           # Vite dev server on :5173, proxies /api and /ws
```

The daemon is plain TypeScript executed by Node 24+ (type stripping), so there is no build
step for `src/` and `bin/`. Keep to erasable syntax: no `enum`, no parameter properties.

## Layout

- `src/core` — everything that touches the OS: paths, state, supervisor, services, sites, TLS.
- `src/server` — the HTTP/WebSocket API; `routes/index.ts` is the whole surface.
- `templates/` — config files rendered into `~/.zampp/etc` on every start.
- `ui/` — the React control panel.
- `tests/` — `node --test`; set `ZAMPP_HOME` to a temp dir in tests, never touch the real one.
- `docs/` — research, architecture decisions and the build report.

## Adding a service

Implement `ServiceDefinition` (`src/core/services/types.ts`): `resolve`, `install`, `prepare`,
`ports`, `health`, `logs`, `configs`. Register it in `src/core/services/index.ts`. Render
its config from a template; never edit files in place.

## Commits

Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`), one logical
change per commit, tests included. Run `npm test && npm run typecheck` before pushing.

## Installers

- `install.sh` — the `curl | sh` installer. Test it against your working tree without touching
  your real install: `ZAMPP_HOME=/tmp/zh ZAMPP_REPO="file://$PWD" sh install.sh`.
- `scripts/make-pkg.sh` — builds `dist/zampp-<version>.pkg` (unsigned) with `pkgbuild`.
