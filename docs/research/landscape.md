# Landscape: XAMPP and the apps that replaced it

Research date: 2026-10-22. Sources are linked inline; anything marked *unverified* was
not confirmed from a primary source during research.

## What XAMPP is (and why people leave)

XAMPP (Apache Friends / Bitnami) bundles Apache, MariaDB, PHP, Perl, phpMyAdmin,
OpenSSL, FileZilla FTP, Mercury Mail, Tomcat, Webalizer and a fake `sendmail`.
On macOS it installs to `/Applications/XAMPP` and is driven by `manager-osx`
(a GUI) or the `xampp` / `lampp` shell script (`start|stop|restart|security|enablessl`).
Configuration lives in `xamppfiles/etc/{httpd.conf,extra/httpd-xampp.conf,php.ini,my.cnf}`.
Default ports: 80, 443, 3306. Source: [Apache Friends macOS FAQ](https://www.apachefriends.org/faq_osx.html).

Pain points, taken from the FAQ itself and from the teardown in
[xampp-teardown.md](xampp-teardown.md):

| Pain point | Evidence |
|---|---|
| Insecure by default | MariaDB `root` has no password, DB reachable over the network, FTP password `lampp`; a separate `xampp security` script is needed to fix it (FAQ). phpMyAdmin ships with `auth_type = config`, `AllowNoPassword = true`, `blowfish_secret = 'xampp'` (teardown). |
| Port conflicts are the #1 support topic | FAQ sections "Apache is already running", "MySQL is already running"; the Windows control panel has a dedicated `portcheck` and "Problem detected" flow (teardown). |
| One PHP version, no switching | A single `php` tree; the whole stack is replaced to upgrade. |
| Virtual hosts are manual | `httpd-vhosts.conf` contains only commented examples; no UI, no `.test` DNS. |
| No mail catching | Mail requires configuring a real SMTP relay (`sendmail.ini`), FAQ says to use PEAR Mail with an external account. |
| Fragile install | The portable edition rewrites absolute paths in every config with `awk` (`install/install.php`) when the folder moves. |
| Not production grade, not portable | Native macOS build is x86_64-only (XAMPP-VM alternative runs Linux in a VM). |

## The alternatives

| Tool | Platform | Approach | What users like | Gaps |
|---|---|---|---|---|
| [MAMP / MAMP PRO](https://www.mamp.info) | macOS, Windows | Native binaries, GUI | PHP version switching, Nginx or Apache, hosts GUI (PRO) | Paid for the useful parts, closed source |
| [Laragon](https://laragon.org) | Windows only | Portable binaries, tray app | Auto virtual hosts (`app.test`), quick-create projects, PHP switching, very fast | Windows only, closed source |
| [Laravel Herd](https://herd.laravel.com) | macOS, Windows | Native: nginx + PHP-FPM + dnsmasq + Node | Zero config `.test` domains, PHP per site, Pro adds DB + Mailpit-style mail | Freemium, closed, Laravel-centric |
| [Laravel Valet](https://github.com/laravel/valet) (MIT, ~2.6k stars) | macOS (Linux/Windows forks) | Homebrew nginx + php-fpm + dnsmasq; PHP CLI tool | `.test` TLD via dnsmasq + `/etc/resolver`, `valet secure` (TLS), `valet isolate` per-site PHP, drivers for frameworks | No DB, no GUI, needs Homebrew |
| [DDEV](https://github.com/ddev/ddev) (Apache-2.0, ~3.9k) | all | Docker per project + router | Reproducible per-project stacks, mkcert TLS, Mailpit built in, many DB versions | Requires Docker, heavier, CLI only |
| [Lando](https://lando.dev), [Devilbox](https://github.com/cytopia/devilbox) (MIT, ~4.5k, inactive since 2024), [Takeout](https://github.com/tighten/takeout) | all | Docker | Service catalogs | Docker required |
| [Local (localwp)](https://localwp.com), [DevKinsta](https://kinsta.com/devkinsta/) | macOS, Windows, Linux | Electron GUI + bundled or Docker services | One-click WordPress sites, SSL, mail, DB GUI, share links | WordPress-only, closed |
| [ServBay](https://www.servbay.com) | macOS, Windows | Native, GUI | 50+ runtimes, mail, DB, MCP server | Closed, freemium |
| [FlyEnv](https://github.com/xpf0000/FlyEnv) (BSD-3, ~3.3k, TypeScript/Electron) | macOS, Windows, Linux | Native binaries via Homebrew/MacPorts/static downloads, Electron GUI | Open source, dozens of service modules, vhost templates for nginx/apache/caddy, hosts-file sync, mkcert, Mailpit, MCP | Huge surface, Electron weight, per-service code is long |
| [EnvKit](https://github.com/Env-Kit/envkit-releases), [DevStackBox](https://alternativeto.net/software/devstackbox/about/), [SmartStack](https://github.com/marcosgamez/smartstack) | Windows | Portable bundles / Electron | Simple XAMPP replacements | Windows only, small or closed |

Reference implementations studied in source: FlyEnv (`src/fork/module/{Base,Apache,Host,Php,Mariadb,MkCert}`),
Laravel Valet (`cli/Valet/DnsMasq.php`, `cli/stubs/site.valet.conf`).

## What a "perfect XAMPP" must do

Derived from the praise/complaint columns above.

**Must**
1. One command / one click to install and start Apache (or Nginx) + PHP-FPM + MariaDB/MySQL.
2. Secure by default: loopback-only binding, generated DB password, token-protected panel. No "security script" afterthought.
3. Port conflict detection with a clear "who is using it" answer and one-click re-port.
4. Sites, not folders: `name.test` virtual hosts created from the UI/CLI with hosts-file or dnsmasq DNS.
5. PHP version switching per site (static-php-cli FPM builds need no Homebrew).
6. Mail catching (Mailpit) wired into `sendmail_path` so `mail()` just works.
7. DB admin UI (Adminer single-file, phpMyAdmin optional) logged in with the generated credentials.
8. Live logs in the panel (Apache error/access, PHP-FPM, MariaDB, Mailpit).
9. Local HTTPS via mkcert.
10. Config files are generated from templates at runtime into `~/.zampp` (never path-rewritten in place).

**Should**
- Doctor/diagnostics command; project templates (plain PHP, Laravel, WordPress); Composer bundled;
  export/import of sites; auto-start at login; Nginx as an alternative engine; Redis service.

**Nice**
- Share links (tunnel), menu-bar app, per-site PHP ini overrides UI, Docker-based service provider.

## Sources
- https://www.apachefriends.org/faq_osx.html, https://www.apachefriends.org/faq_linux.html
- https://github.com/xpf0000/FlyEnv, https://github.com/laravel/valet, https://github.com/ddev/ddev
- https://github.com/axllent/mailpit (v1.31.6, darwin-arm64 binaries), https://github.com/FiloSottile/mkcert (v1.4.4)
- https://github.com/vrana/adminer (v6.1.2 single file), https://www.phpmyadmin.net (5.2.3)
- https://dl.static-php.dev/static-php-cli/common/ (php-8.5.8 cli + fpm macOS aarch64 tarballs; verified running locally)
- https://dev.to/bytecrusher99/top-6-alternatives-to-xampp-for-local-development-environments-5po
- https://instawp.com/laragon-alternative-for-website-development/
- https://alternativeto.net/software/xampp/
