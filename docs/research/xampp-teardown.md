# XAMPP teardown (reverse engineering notes)

Target: `xampp-portable-windows-x64-8.2.12-0-VS16.7z` from the official SourceForge
mirror, SHA-256 `4098bb3c9c7f0cec0b0f6e09c35df87cbc02cff47badec9281c98adb3709b9c0`,
19,997 archive members. The Windows portable edition was chosen because it is the only
XAMPP distribution that ships as a plain archive (the macOS and Linux editions are
BitRock installers that cannot be unpacked without running them).

Method: the REA (Reverse Engineer Anything) skill's routing rules plus the leanrea
"plain CLI tools" fast path. Inventory with `bsdtar`, selective extraction, `file`,
`objdump -x`, `strings`, then reading configs. Each claim below is marked **seen**
(found in the artifact) or **inferred**. The REA MCP/CLI itself could not be executed
in this session (the session's permission classifier blocked `npx rea-agents`), so no
decompilation was done; everything here is static-string and config evidence.

## 1. Layout (seen)

```
xampp/
  xampp-control.exe   3.3 MB  PE32 GUI, i386, Delphi VCL + JCL (seen: Vcl.Themes.*, TJcl* RTTI)
  xampp-control.ini   control panel state (sections below)
  xampp_start.exe / xampp_stop.exe  116 KB console launchers
  apache_start.bat    runs apache\bin\httpd.exe in the foreground
  mysql_start.bat     runs mysql\bin\mysqld --defaults-file=mysql\bin\my.ini --standalone
  setup_xampp.bat     runs php -n install\install.php usb  (path rewriter)
  install/            install.php, portcheck.php, config.awk, awk.exe, *.inc, .version = 8.2.12
  apache/ php/ mysql/ phpMyAdmin/ perl/ tomcat/ sendmail/ webdav/ webalizer/ htdocs/ tmp/ licenses/
  passwords.txt readme_en.txt readme_de.txt
```

## 2. Control panel model (seen in `xampp-control.ini` + binary strings)

`xampp-control.ini` is the whole data model of the control panel:

| Section | Keys | Meaning |
|---|---|---|
| `[Autostart]` | Apache, MySQL, FileZilla, Mercury, Tomcat = 0/1 | start on panel launch |
| `[Checks]` | CheckRuntimes, CheckDefaultPorts | pre-flight checks (VC++ runtime, ports) |
| `[BinaryNames]` | Apache=httpd.exe, MySQL=mysqld.exe, ... | process names to look for |
| `[ServiceNames]` | Apache=Apache2.4, MySQL=mysql, ... | Windows service names |
| `[ServicePorts]` | Apache=80, ApacheSSL=443, MySQL=3306, FileZilla=21, Mercury1..7, TomcatHTTP=8080, TomcatAJP=8009 | expected ports |
| `[UserConfigs]` / `[UserLogs]` | per module | extra config/log files shown in the Config/Logs buttons |
| `[EnableServices]` / `[EnableModules]` | per module | which rows are shown / service-installable |
| `[LogSettings]` / `[WindowSettings]` | font, geometry | UI state |

Binary strings confirm the UI: form captions "Service and Port Settings",
"Netstat - TCP Listening sockets", "User-defined log/config-files",
"Configuration of Control Panel", "Check default ports on startup",
"Start Control Panel Minimized"; event handlers `bApacheAdminClick`, `bNetstatClick`,
`bServiceSettingsClick`, `b<Module>ServiceClick`; helpers `GetPorts4PID`, `BlockedCount`,
`CheckImports`, `TimerUpdateStatusTimer`. The settings form's help text says the port
table "does NOT change the ports that the services and programs use" (seen) — the panel
only *checks* ports, it never edits configs. That is the gap behind the eternal
"Port 80 in use" support threads.

`install/portcheck.php` (seen) is the port checker: `fsockopen("127.0.0.1", port, 1s)`
per port, writes `Port80=FREE|BLOCKED` into `install/portcheck.ini`.

Inferred architecture of the panel: a Delphi `TTimer` polls process list by binary
name (`[BinaryNames]`) and maps PIDs to listening ports (`GetPorts4PID`), colouring each
row; the Start button spawns the binary with the stack-relative config; Admin opens
`http://localhost/` or `/phpmyadmin`; Netstat lists TCP listeners. No service
supervision, no log tailing beyond a text box, no config generation.

## 3. Service wiring (seen)

- **Apache**: `httpd.conf` `Listen 80` (all interfaces), `ServerRoot "/xampp/apache"`,
  `DocumentRoot "/xampp/htdocs"`, includes `extra/httpd-xampp.conf` which loads PHP as an
  Apache module (`LoadModule php_module php8apache2_4.dll`, `PHPINIDir`), restricts
  `/phpmyadmin`, `/licenses`, `/webalizer` with `Require local`, and sets `SetEnv PHPRC`,
  `MYSQL_HOME`, `OPENSSL_CONF`, `TMP`. `httpd-vhosts.conf` has only commented examples.
- **MariaDB**: `mysql/bin/my.ini`: `port=3306`, `datadir=/xampp/mysql/data`,
  `innodb_buffer_pool_size=16M`, `log_error=mysql_error.log`, *no* `bind-address`
  (so it listens on all interfaces), `sql_mode=NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION`.
- **PHP**: `php.ini`: `display_errors=On`, `error_reporting=E_ALL`, `memory_limit=512M`,
  `upload_max_filesize=40M`, `post_max_size=40M`, `max_execution_time=120`,
  `date.timezone=Europe/Berlin`, extensions bz2 curl fileinfo gettext mbstring exif
  mysqli pdo_mysql pdo_sqlite openssl ftp. Mail defaults to `mailToDisk` writing
  `.eml` files to `<xampp>\mailoutput` (readme), alternative `sendmail/sendmail.ini` relays
  to a real SMTP server.
- **phpMyAdmin** `config.inc.php`: `auth_type=config`, user `root`, empty password,
  `AllowNoPassword=true`, `blowfish_secret='xampp'`, controluser `pma` with empty password.
- **Path rewriting**: `install/install.php` reads `.version`, builds `$partwampp`, and
  uses `awk` scripts (`config.awk`) to replace the absolute install prefix inside
  `httpd.conf`, `php.ini`, `my.ini`, etc. whenever the folder moves (seen). This is why
  moving XAMPP breaks configs if the script is not re-run.

## 4. Security posture (seen; `passwords.txt`, `readme_en.txt`)

- MariaDB root: no password. "The MySQL daemon is accessible via network."
- phpMyAdmin auto-login as root, cookie secret is the literal string `xampp`.
- Mercury test user `newuser` / `wampp`; WebDAV `xampp-dav-unsecure` / `ppmax2011`.
- Readme section "A matter of security (A MUST READ!)" lists all of the above as known.

## 5. What zampp takes from this

| XAMPP behaviour | zampp decision |
|---|---|
| INI-driven list of modules with binary names, ports, autostart flags | Keep the idea; model it as a typed `ServiceDefinition` registry (`src/core/services/*.ts`) with ports, health checks, config/log file lists. |
| Port check that only *reports* | Detect the owning process (`lsof`) **and** offer one-click re-port that regenerates configs. |
| Panel polls by process name | Supervise child processes directly (pid files + health probes), WebSocket push to the UI. |
| Configs rewritten in place with awk | Render configs from templates on every start into `~/.zampp/etc`; the stack is relocatable by construction. |
| Apache mod_php, single PHP | Apache or Nginx → PHP-FPM over FastCGI; one FPM pool per PHP version; static-php-cli builds enable per-site version switching without Homebrew. |
| Root without password, network-exposed DB | Loopback-only `bind-address`, generated root password, DB UI pre-wired with it. |
| `mailToDisk` / relay | Mailpit on 127.0.0.1:1025/8025 and `sendmail_path = mailpit sendmail`. |
| Admin button → `/phpmyadmin` | Adminer by default (single PHP file, works on PHP 8.5), phpMyAdmin optional. |
| Netstat window | "Ports" panel listing every listener with PID/command. |
| `xampp security` script | No script: secure defaults from the first start. |
