<p align="center">
  <img src="docs/assets/logo.svg" alt="zampp" width="96" height="96">
</p>

<h1 align="center">zampp</h1>

<p align="center"><strong>The vibecoded, open-source XAMPP.</strong><br>
Apache + PHP-FPM + MySQL/MariaDB + phpMyAdmin + Mailpit, secure by default, with a real control panel and a CLI.<br>
One command to install, one command to start, <code>myapp.test</code> sites in one click.</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-35c46a.svg"></a>
  <img alt="Node 24+" src="https://img.shields.io/badge/node-%E2%89%A524-339933?logo=nodedotjs&logoColor=white">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-Apple%20Silicon%20%7C%20Intel-000?logo=apple&logoColor=white">
  <a href=".github/workflows/ci.yml"><img alt="CI" src="https://github.com/MHK-26/zampp/actions/workflows/ci.yml/badge.svg"></a>
</p>

---

```
$ zampp start
Starting zampp
  … Adminer v6.1.2 ready
  … Mailpit v1.31.6 ready
  … Starting php-fpm:8.5.11
  … Starting apache
  … Starting mariadb
  … Starting mailpit
  … Database root password set for every root account

  ● running   Apache           2.4.67   :8080   pid 16965
  ● running   PHP-FPM 8.5.11   8.5.11           pid 16037
  ● running   PHP-FPM 8.4.23   8.4.23           pid 16930
  ● running   MariaDB          13.0.2   :3306   pid 16102
  ● running   Mailpit          1.31.6   :1025 :8025  pid 16106

  Web      http://localhost:8080/
  Mail     http://127.0.0.1:8025/
  DB       127.0.0.1:3306  user root  (zampp db for the password)
  Panel    zampp ui
```

## Why not just XAMPP?

XAMPP has been the on-ramp to PHP for twenty years, and it still ships the same way it did in
2005. We took it apart (see [docs/research/xampp-teardown.md](docs/research/xampp-teardown.md))
and fixed the things everybody complains about.

| | XAMPP | zampp |
|---|---|---|
| Database root password | none, reachable from the network | generated on first start, loopback only |
| phpMyAdmin | auto-login as root with no password, cookie secret `xampp` | phpMyAdmin auto-login too, but root has a generated password, MySQL is loopback-only, secret is random; Adminer as a lighter alternative |
| Port 80 already in use | "Problem detected!" and a netstat window | tells you which process has it, falls back to 8080/8443 automatically |
| PHP versions | one, replace the whole stack to upgrade | any number side by side, per site, 15 MB static builds, no Homebrew needed |
| Virtual hosts | edit `httpd-vhosts.conf` by hand | `zampp site add blog ~/code/blog` → `http://blog.test/` |
| Email from `mail()` | configure a real SMTP relay | caught by Mailpit, nothing leaves your machine |
| HTTPS | self-signed cert warnings | mkcert, trusted by your browser |
| Config files | absolute paths rewritten by an awk script | rendered from templates on every start, relocatable |
| Logs | open the files | live tail in the panel |
| Control panel | Delphi app that polls process names | web panel + CLI, same API, token protected |
| Source | closed installer, Bitnami stacks | MIT, ~4.5k lines of TypeScript you can read in an afternoon |

## Install

Requirements: **macOS 13+** (Apple Silicon or Intel) with **Node.js 24+**. Homebrew is only
needed for MariaDB; Apache comes with macOS, PHP and everything else is downloaded for you.
Linux is designed-for but not yet tested.

```bash
git clone https://github.com/MHK-26/zampp.git
cd zampp
npm install && npm --prefix ui install && npm run build:ui
npm link                 # puts `zampp` on your PATH
zampp start              # provisions what is missing and starts the stack
zampp gui                # native control panel (macOS); `zampp ui` for the web panel
```

Everything zampp creates lives in `~/.zampp` (binaries, configs, data, logs, secrets). Delete
that folder and it is gone. Set `ZAMPP_HOME` to put it somewhere else.

## What you get

| Service | Version | Where it comes from | Port |
|---|---|---|---|
| Apache httpd | 2.4 | macOS (or Homebrew) | 80 → 8080 when 80 needs admin rights |
| PHP-FPM | 8.1 … 8.5, several at once | Homebrew installs are detected; otherwise [static-php-cli](https://static-php.dev) builds | unix sockets |
| MySQL (MariaDB by default, like XAMPP; Oracle MySQL selectable) | 11 / 13 | Homebrew (installed for you) | 3306, 127.0.0.1 only |
| Mailpit | latest | GitHub release | SMTP 1025, UI 8025 |
| phpMyAdmin | latest | phpmyadmin.net | `http://localhost:8080/phpmyadmin/` |
| Adminer | latest | GitHub release | `http://localhost:8080/adminer/` |
| mkcert | latest | GitHub release, on first HTTPS site | — |
| Control panel | — | this repo | 1980, token protected |

## The control panel

Two flavours, same API.

**Desktop (macOS)** — `zampp gui` opens a small native window, the XAMPP manager you remember:
one row per service with a green/red light, version, ports, PID and Start / Stop / Restart /
Logs buttons, plus Start All, Stop All, Localhost, Database, Mail, Doctor and an activity log.
It is ~600 lines of AppKit in [`desktop/macos/main.swift`](desktop/macos/main.swift), compiled
on first run with the system Swift toolchain (Xcode command line tools). No Electron.

**Web** — `zampp ui` opens the full panel on `127.0.0.1:1980`.

- **Dashboard** — every service with start/stop/restart, doctor problems, quick links.
- **Services** — versions, PIDs, uptime, ports, and the generated config files in an editor.
- **Sites** — create `name.test` sites with a document root, PHP version, aliases and HTTPS.
- **PHP** — install more versions with one click, switch the default, detect Homebrew PHP.
- **Database** — credentials with copy buttons, PDO and `.env` snippets, Adminer link.
- **Mail** — Mailpit inbox embedded, config snippets for PHP, Laravel, WordPress.
- **Logs** — live tail of every log file over WebSocket, with filter and pause.
- **Ports** — every listening TCP port on the machine and who owns it.
- **Doctor** — the same checks as `zampp doctor`, with fixes.
- **Settings** — TLD, every port, autostart list; tells you what to restart.

## The CLI

```
zampp start | stop | restart | status | doctor
zampp gui                            native desktop panel (macOS)
zampp ui | serve                     web panel (or API only)

zampp site add <name> [path] [--php 8.3] [--tls] [--alias www.name.test]
zampp site rm <name>
zampp site list
zampp hosts sync                     write /etc/hosts entries (asks for your password)

zampp php list | install 8.3 | use 8.3.30 | detect

zampp db                             print database credentials
zampp mail                           open the Mailpit inbox
zampp open                           open http://localhost
```

### Sites and PHP versions

```bash
zampp php install 8.1                       # newest 8.1.x, static build
zampp site add legacy ~/code/legacy --php 8.1
zampp site add shop ~/code/shop/public --tls
```

`legacy.test` runs PHP 8.1 and `shop.test` runs your default PHP over HTTPS, both behind the
same Apache, each with its own PHP-FPM pool, `.htaccess` support and log files. Sites resolve
through a managed block in `/etc/hosts` (one admin prompt per change); set `ZAMPP_SKIP_HOSTS=1`
to manage DNS yourself.

### Ports 80 and 443

Most systems refuse to let a normal user bind ports below 1024. zampp detects that and uses
8080/8443, so `http://localhost:8080/` instead of `http://localhost/`. If you want the classic
ports on macOS, forward them once with the packet filter:

```bash
echo "rdr pass inet proto tcp from any to 127.0.0.1 port 80 -> 127.0.0.1 port 8080
rdr pass inet proto tcp from any to 127.0.0.1 port 443 -> 127.0.0.1 port 8443" | sudo pfctl -ef -
```

## How it works

```
 control panel (React)  ──►  API  127.0.0.1:1980  ──►  core  ──►  ~/.zampp
 zampp CLI              ──►  (node:http + ws)          supervisor    bin/  etc/  logs/  run/
                                                       services      www/  data/ ssl/
                                                       sites · tls   state.json  secrets.json
```

- **Templates, not edits.** `httpd.conf`, every vhost, `php-fpm.conf`, `php.ini` and `my.cnf`
  are rendered from [`templates/`](templates) into `~/.zampp/etc` on each start. Nothing is
  patched in place, so moving or re-installing never breaks a config.
- **A supervisor, not a process scanner.** Services are spawned in the foreground mode
  (`httpd -D FOREGROUND`, `php-fpm -F`, `mariadbd`, `mailpit`) as detached children with pid
  files and health probes. They keep running when you close the panel and are re-adopted by
  the next CLI run.
- **Secure by default.** Every service binds `127.0.0.1`. The database root password is
  generated once and stored with mode `0600`. The API needs a bearer token (`zampp ui` passes
  it for you). Nothing runs as root; the only privileged actions are writing `/etc/hosts` and
  trusting the local CA, both behind the system password dialog.
- **Small on purpose.** Two runtime dependencies (`ws`, `zod`). No Docker, no Electron, no
  build step for the daemon: Node runs the TypeScript directly.

Read [docs/architecture.md](docs/architecture.md) for the decisions and trade-offs, and
[docs/research/landscape.md](docs/research/landscape.md) for how MAMP, Laragon, Herd, Valet,
DDEV, Local, ServBay and FlyEnv compare.

## Status and roadmap

zampp works end to end on macOS today: this README's output is real. It is young software.

- [ ] Nginx as an alternative web engine (same `ServiceDefinition` interface)
- [ ] Redis, PostgreSQL, Node version management
- [ ] Project templates: WordPress, Laravel, plain PHP, Composer bundled
- [ ] dnsmasq provider for wildcard `*.test` without hosts-file prompts
- [ ] Linux and Windows (WSL first) support
- [ ] Menu-bar mode for the desktop panel; share links via a tunnel
- [ ] npm publish so `npx zampp start` works

## Vibecoded

zampp was built in a single autonomous AI coding session, from competitive research and a
teardown of the real XAMPP binaries to the running stack you see above. The process, the
tooling used ([Everything Claude Code](https://github.com/affaan-m/everything-claude-code),
[Reverse Engineer Anything](https://github.com/morluto/rea), [leanrea](https://github.com/aicodeking/leanrea))
and an honest evaluation of what helped and what did not are in
[docs/report.md](docs/report.md). Every step is a commit; read the history.

## Standing on

[static-php-cli](https://github.com/crazywhalecc/static-php-cli) · [Mailpit](https://github.com/axllent/mailpit) ·
[Adminer](https://github.com/vrana/adminer) · [mkcert](https://github.com/FiloSottile/mkcert) ·
[MariaDB](https://mariadb.org) · [Apache httpd](https://httpd.apache.org) · architecture ideas from
[FlyEnv](https://github.com/xpf0000/FlyEnv) and [Laravel Valet](https://github.com/laravel/valet).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `npm test` runs in seconds and never touches your real
`~/.zampp`.

## License

[MIT](LICENSE)
