# Build report: how zampp was made, and whether the tools helped

Date: 2026-10-22. One autonomous Claude Code session (model: Claude Fable 5.1), macOS 27 on
Apple Silicon, Node 26. Brief from the owner: study XAMPP and its competitors, reuse what the
internet already offers, use **Everything Claude Code (ECC)** and **Reverse Engineer Anything
(REA)** as tooling, commit every step, publish to GitHub with a good README, and end with an
honest evaluation of the process and the tools. No questions allowed mid-flight.

## 1. What was delivered

| Area | Result |
|---|---|
| Research | `docs/research/landscape.md` (12 competing tools, feature matrix, must/should/nice list) and `docs/research/xampp-teardown.md` (XAMPP 8.2.12 portable archive, 19,997 members, control panel binary and every default config read). |
| Architecture | `docs/architecture.md`: 12 ADRs, module map, API table, phased plan. |
| Daemon | ~2,400 lines of TypeScript run directly by Node (no build): supervisor, 4 service definitions (Apache, PHP-FPM per version, MariaDB, Mailpit), provisioning (static-php-cli, GitHub releases, Homebrew), sites/vhosts, hosts-file management, mkcert TLS, doctor. |
| API | 30 routes under `/api/v1` plus a WebSocket log tail; bearer-token auth; error envelope per the ECC api-design skill. |
| CLI | `zampp start/stop/restart/status/ui/serve/doctor/site/hosts/php/db/mail/open`. |
| Control panel | React + Vite, 10 pages, dark/light, 79 kB gzipped. |
| Tests | 35 tests (`node --test`), 0 type errors, UI builds; line coverage 66% (`src/**`). |
| Verified live | PHP 8.5.11 (Homebrew) and 8.4.23 (static) serving two sites side by side through Apache with `.htaccess` rewrites; MariaDB with the generated password enforced over TCP and no-password login refused; `mail()` landing in Mailpit; Adminer prefilled; API, doctor, ports, WebSocket tail. |
| Commits | 16, conventional, one step each. |

Known gaps, stated plainly:

- **Coverage is 66%, not the 80% ECC asks for.** The uncovered code is in the modules that spawn
  real processes (`supervisor`, `mariadb`, `stack`, `tls`, `logs`). They were exercised by hand
  on the live stack, not by automated tests. A test that boots the real stack in a temp
  `ZAMPP_HOME` on random ports is the right next step.
- **The React panel was never looked at in a browser.** It type-checks and builds, every API it
  calls is tested, but no screenshot or click-through happened; browser tools were unavailable
  in this session. Expect visual rough edges.
- **Untested flows:** the `/etc/hosts` admin prompt (every run used `ZAMPP_SKIP_HOSTS=1`),
  mkcert CA installation and HTTPS sites, Homebrew Apache (only the macOS system httpd ran),
  MySQL as the DB flavour, Linux.
- **Ports 80/443** bind with `EACCES` on this machine, so the "classic" `http://localhost/`
  is `http://localhost:8080/` unless you forward ports. The README documents the pf one-liner.

## 2. Timeline

1. Environment survey (Node 26, PHP 8.5, system httpd, no DB, Homebrew).
2. Web research: XAMPP FAQ, alternatives, binary sources; cloned ECC, REA, leanrea, FlyEnv and
   Laravel Valet into a scratch directory and read their relevant parts.
3. Vendored a curated ECC subset plus the REA and leanrea skills into `.claude/` and wrote
   `CLAUDE.md`. Commit.
4. Downloaded the XAMPP portable archive, inventoried and selectively extracted it, analysed the
   control panel binary and configs. Wrote both research documents. Commit.
5. Architecture doc with ADRs. Commit.
6. Scaffold (hit two tooling problems, see §4). Commit.
7. Core modules with tests first where the module was pure (templates, ports, hosts, state,
   secrets, php index parsing, sites). Three bugs caught by tests before any service ran:
   lsof column parsing, hosts-block removal leaving a blank line, nested template sections.
8. Services, supervisor, sites, TLS, welcome page, Adminer wrapper. Commit.
9. API server, routes, CLI. Commit. First real `zampp start`: PHP-FPM, MariaDB and Mailpit up,
   Apache failed on port 80 (`EACCES`), and the MariaDB password had only been set on one of
   four root accounts, so TCP login without a password still worked. Both fixed, re-verified.
10. Static PHP 8.4 install, site pinned to it, two PHP versions live. Commit.
11. API integration tests, state reload across processes, 201/doctor/tail fixes. Commit.
12. React panel (10 pages). Commit.
13. ECC verification loop, security hardening of site inputs, README, license, CI, this report.
14. GitHub publish.

## 3. Did the tools help?

### Everything Claude Code (ECC) — github.com/affaan-m/everything-claude-code

Installed by vendoring a curated subset (9 agents, 7 commands, 8 skills, common + TypeScript
rules) rather than the full plugin, because the full repo is 613 skills and the hooks require
its own bootstrap scripts.

What helped, concretely:

- **Rules** (`rules/common/coding-style.md`, `security.md`, `testing.md`, `rules/typescript/*`).
  Reading them up front shaped real decisions: `unknown` + narrowing instead of `any`, zod for
  every request body, immutable state updates (`upsertSite` returns a new state), no
  `console.log` in `src/`, explicit error envelopes. These are things a careful engineer does
  anyway, but having them written down made them non-negotiable in an autonomous session.
- **api-design skill.** Used directly for the route table: plural nouns, 201 + Location
  semantics, 409 for duplicates, 422 with field-level details, `{ error: { code, message,
  details } }`. The API integration tests assert exactly those contracts.
- **verification-loop skill.** Ran as the final gate (build, types, tests + coverage, secret
  grep, diff review). It is the reason the coverage number above is stated rather than assumed.
- **planner / architect templates.** The architecture document follows their format (overview,
  requirements, decisions with alternatives and rationale, phased steps, risks). Useful as a
  checklist; it forced the ADR table.
- **git-workflow / conventional-commit-review.** Commit discipline came from here (and from the
  owner's instruction to commit every step).

What did not help, or could not be used:

- **Agents as subagents.** ECC's model is "delegate to `planner`, then `code-reviewer`, then
  `security-reviewer`". Spawning subagents was declined by the session's permission settings
  at the start, so the agent prompts were applied by reading them and following their
  checklists in-line. That still worked, but the parallel multi-agent review ECC describes did
  not happen.
- **Hooks.** ECC's hook set (pre-bash guards, formatters, session persistence) needs its
  bootstrap script and plugin install; not vendored, not used.
- **Volume.** 613 skills and 71 agents is a lot to sift; perhaps 10 files were actually load-bearing.
  The value was in those 10, not in the catalogue. Picking a small subset and pinning the
  upstream commit (`.claude/ECC_COMMIT`) is the recommended way to adopt it.
- **The 80% coverage rule** was adopted as a target and missed (66%). The rule is right; the
  session ran out of budget for a real end-to-end harness. Reporting the miss is itself a
  product of the rule.

Verdict: **yes, moderately.** ECC worked as a written-down engineering process for an
autonomous agent, and the api-design and verification-loop skills had direct, visible effects
on the code. It did not work as an agent orchestration layer in this session.

### Reverse Engineer Anything (REA) — github.com/morluto/rea, plus leanrea

- The **REA skill** (`reverse-engineer-anything/SKILL.md`) was useful for its routing rules
  and its evidence discipline: route by artifact type, inventory before decompiling, mark
  every claim as seen/inferred/unknown. The teardown document follows that discipline.
- The **REA CLI/MCP could not be run.** `npx rea-agents` was blocked by the session's
  permission classifier as external code. No decompilation or managed-code inspection happened.
- **leanrea** (the 8 KB "plain CLI tools" variant) covered what was actually needed:
  `bsdtar` for the 7z inventory and selective extraction, `file`, `objdump -x` for PE imports,
  `strings` for the Delphi form captions, event handler names and INI section keys, then reading
  the configs. That was enough to reconstruct the control panel's data model
  (`xampp-control.ini` sections, `portcheck.php`, "the port table does NOT change the ports
  the services use") and the stack wiring, which directly produced the "what zampp takes from
  this" table and several design decisions (templates not path rewriting, supervisor not
  process scanning, secure defaults, per-site PHP-FPM).
- Caveat: the target was the **Windows** portable archive, because the macOS and Linux XAMPP
  distributions are BitRock installers that cannot be unpacked without running them.

Verdict: **the approach helped a lot, the heavy tool was not usable here.** The reverse
engineering changed the product (the comparison table in the README is evidence-based rather
than folklore), but every finding came from static strings and config files via standard CLI
tools, which leanrea documents in one page.

### Repositories reused or studied

| Repo | How it was used |
|---|---|
| crazywhalecc/static-php-cli | Download source for PHP FPM/CLI builds; verified 8.5.8 and 8.4.23 run with mysqlnd, pdo_mysql, gd, zip, redis. The reason PHP version switching needs no Homebrew. |
| axllent/mailpit | Downloaded binary; `mailpit sendmail -S` wired as PHP `sendmail_path`. |
| vrana/adminer | Single-file DB UI, wrapped with a prefilled login form. |
| FiloSottile/mkcert | TLS provider (downloaded on first HTTPS site; untested end to end). |
| xpf0000/FlyEnv | Read `src/fork/module/{Base,Apache,Host,Php,Mariadb,MkCert}`; adopted foreground spawning, pid files, vhost templates, managed hosts block, `--defaults-file` MariaDB launch. |
| laravel/valet | Read `DnsMasq.php` and nginx stubs; dnsmasq + `/etc/resolver` noted as the future wildcard-DNS provider. |
| ApacheFriends XAMPP 8.2.12 | The artifact under study. |

## 4. Problems hit and how they were solved

| Problem | Resolution |
|---|---|
| `npm install` failed with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`; Node's bundled CA store did not validate the registry chain on this machine (curl was fine). | Exported the macOS keychain roots to a PEM and set `NODE_EXTRA_CA_CERTS`. zampp's own downloader prefers `curl` for the same reason. |
| npm 11 blocked esbuild's postinstall script, so Vite had no binary. | `npm install-scripts approve esbuild`. |
| Zod 4 `.default({})` on nested object schemas skips inner defaults. | `.prefault({})`, caught by the first state test. |
| Template engine matched the wrong `{{/if}}` with nested sections. | Depth-aware section matching, caught by the sites test. |
| Ports 80/443 `EACCES` for a normal user. | `probePort` distinguishes busy from denied; the stack falls back to 8080/8443 and persists the choice. |
| `mariadb-install-db` creates four root accounts (`localhost`, `127.0.0.1`, `::1`, hostname); only one got the password, and the hostname row's case broke `ALTER USER`. | One `UPDATE mysql.global_priv … WHERE user='root'` plus `FLUSH PRIVILEGES`; error output redacts the password. |
| Subagents and `npx rea-agents` were denied by permissions. | Did the work in-line; recorded the limitation here. |

## 5. What I would do differently

1. Write the end-to-end harness (temp `ZAMPP_HOME`, random ports, real processes) before the
   React panel. Coverage of the risky code would be real instead of manual.
2. Screenshot the panel. Even one headless render would have caught layout mistakes.
3. Adopt ECC as a small pinned subset from the start (done here) and wire its hooks only if
   the plugin install path is available; do not try to use 600 skills.
4. For reverse engineering without a decompiler, start from leanrea's one-page router; reach
   for REA's MCP only when pseudocode is needed and the environment allows it.

## 6. Numbers

| Metric | Value |
|---|---|
| Commits | 16 (before publish) |
| Source lines (ts/tsx, excluding deps) | ~4,500 |
| Runtime dependencies | 2 (`ws`, `zod`) |
| Tests | 35 passing, 0 failing |
| Type errors | 0 (daemon and UI) |
| Line coverage (`src/**`) | 66% |
| Services verified live | 5 (Apache, PHP-FPM ×2, MariaDB, Mailpit) |
| External binaries provisioned automatically | Adminer, Mailpit, PHP 8.4.23 (MariaDB via Homebrew) |
