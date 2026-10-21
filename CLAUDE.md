# zampp — CLAUDE.md

zampp is an open-source, better XAMPP: a local web development stack manager
(Apache/Nginx + PHP-FPM + MariaDB/MySQL + Mailpit + Adminer/phpMyAdmin + TLS +
.test domains) with a browser control panel and a CLI. macOS first, portable later.

## Stack
- Node.js 26 (type-stripped TypeScript, run `.ts` directly; erasable syntax only:
  no `enum`, no parameter properties, no namespaces).
- Backend: `node:http` + `ws`; UI: Vite + React + TypeScript (in `ui/`).
- Tests: `node --test` (`npm test`). Type check: `npm run typecheck`.
- State and runtime live outside the repo in `~/.zampp` (override with `ZAMPP_HOME`).

## Commands
```bash
npm install
npm run dev        # API + UI dev servers
npm test           # unit + integration tests
npm run typecheck
node bin/zampp.ts doctor|start|stop|status|site add <name> <path>
```

## Engineering process (from ECC — Everything Claude Code)
Vendored under `.claude/` (pinned commits in `.claude/*_COMMIT`):
- Agents: planner, architect, typescript-reviewer, code-reviewer, security-reviewer,
  tdd-guide, doc-updater, refactor-cleaner, silent-failure-hunter.
- Commands: /plan, /code-review, /security-scan, /learn, /update-docs, /quality-gate,
  /test-coverage.
- Skills: verification-loop, api-design, security-review, git-workflow,
  frontend-patterns, continuous-learning, brownfield-retrospective,
  conventional-commit-review, reverse-engineer-anything (REA), leanrea.
- Rules: `.claude/rules/common/*` and `.claude/rules/typescript/*` apply.

Workflow: plan → tests first → implement → verification-loop → conventional commit
after every step (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`).

## Security defaults (deliberately better than XAMPP)
- Services bind to 127.0.0.1 only. DB root gets a generated password stored in
  `~/.zampp/secrets.json` (mode 0600). Control panel API requires a local token.
- Never run services as root. Never write outside `~/.zampp` without an explicit
  user action (hosts file, trust store) that goes through the privileged helper.

## Reference material
- `docs/research/` — competitive analysis, XAMPP reverse-engineering notes (REA/leanrea).
- `docs/architecture.md` — design and ADRs.
- `docs/report.md` — end-of-project evaluation of process and tooling.
