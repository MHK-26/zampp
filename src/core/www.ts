import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import type { AppContext } from './context.ts'
import { download, exists, latestGithubAsset } from './provision.ts'
import type { ProgressFn } from './provision.ts'

/** Welcome page served at http://localhost/. Never contains secrets. */
export async function writeWelcomeSite(ctx: AppContext): Promise<void> {
  await mkdir(ctx.paths.www, { recursive: true })
  const index = join(ctx.paths.www, 'index.php')
  if (await exists(index)) return
  await writeFile(index, WELCOME_PHP, 'utf8')
  await writeFile(join(ctx.paths.www, 'phpinfo.php'), '<?php phpinfo();\n', 'utf8')
}

export function adminerPath(ctx: AppContext): string {
  return join(ctx.paths.www, 'adminer', 'index.php')
}

/** Adminer, with the server and user prefilled so only the generated password is typed. */
export async function ensureAdminer(ctx: AppContext, progress: ProgressFn = () => {}): Promise<string> {
  const dir = join(ctx.paths.www, 'adminer')
  const core = join(dir, 'adminer-core.php')
  if (!(await exists(core))) {
    const asset = await latestGithubAsset('vrana/adminer', (n) => /^adminer-\d+\.\d+\.\d+\.php$/.test(n))
    await mkdir(dir, { recursive: true })
    await download(asset.url, core, progress)
    progress(`Adminer ${asset.tag} ready`)
  }
  const port = ctx.state.settings.db.port
  const wrapper = `<?php
// zampp Adminer wrapper: prefill the local server and root user.
function adminer_object() {
    class ZamppAdminer extends Adminer\\Adminer {
        function name() { return 'zampp DB'; }
        function loginForm() {
            echo '<table class="layout">';
            echo '<tr><th>Server<td><input name="auth[server]" value="127.0.0.1:${port}" readonly>';
            echo '<tr><th>Username<td><input name="auth[username]" value="root" autocapitalize="off">';
            echo '<tr><th>Password<td><input type="password" name="auth[password]" autofocus>';
            echo '<tr><th>Database<td><input name="auth[db]" autocapitalize="off">';
            echo '</table>';
            echo '<p><input type="submit" value="Login"> <label><input type="checkbox" name="auth[permanent]" value="1"> Permanent login</label>';
            echo '<p class="message">The root password is in the zampp control panel (Database page).</p>';
        }
    }
    return new ZamppAdminer;
}
include __DIR__ . '/adminer-core.php';
`
  await writeFile(adminerPath(ctx), wrapper, 'utf8')
  return adminerPath(ctx)
}

const WELCOME_PHP = `<?php $php = PHP_VERSION; $server = $_SERVER['SERVER_SOFTWARE'] ?? 'Apache'; ?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>zampp is running</title>
<style>
  :root { color-scheme: light dark; --bg:#0f1115; --fg:#e8e8ea; --muted:#9aa0a6; --card:#181b22; --accent:#35c46a; }
  @media (prefers-color-scheme: light) { :root { --bg:#f6f7f9; --fg:#14161a; --muted:#5f6670; --card:#fff; } }
  body { margin:0; font: 16px/1.5 -apple-system, system-ui, Segoe UI, Roboto, sans-serif; background:var(--bg); color:var(--fg); }
  main { max-width: 860px; margin: 8vh auto; padding: 0 16px; }
  h1 { font-size: 2rem; margin: 0 0 .25rem; } h1 span { color: var(--accent); }
  p.lead { color: var(--muted); margin-top: 0; }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(240px,1fr)); gap: 16px; margin-top: 32px; }
  a.card { display:block; background:var(--card); border-radius: 12px; padding: 18px; text-decoration:none; color:inherit; border:1px solid rgba(127,127,127,.15); }
  a.card:hover { border-color: var(--accent); }
  a.card strong { display:block; margin-bottom: 4px; } a.card small { color: var(--muted); }
  code { background: rgba(127,127,127,.15); padding: 2px 6px; border-radius: 6px; }
</style>
</head>
<body>
<main>
  <h1><span>zampp</span> is running</h1>
  <p class="lead">PHP <?= htmlspecialchars($php) ?> behind <?= htmlspecialchars($server) ?>. Put files in this folder or create a site from the control panel.</p>
  <div class="grid">
    <a class="card" href="http://127.0.0.1:1980/"><strong>Control panel</strong><small>Start and stop services, add sites, switch PHP, read logs.</small></a>
    <a class="card" href="/adminer/"><strong>Database (Adminer)</strong><small>127.0.0.1:3306, user root. The password lives in the panel.</small></a>
    <a class="card" href="http://127.0.0.1:8025/"><strong>Mail (Mailpit)</strong><small>Every <code>mail()</code> call lands here. Nothing leaves this machine.</small></a>
    <a class="card" href="/phpinfo.php"><strong>phpinfo()</strong><small>Loaded extensions and ini settings for the default PHP.</small></a>
  </div>
  <p style="margin-top:40px;color:var(--muted)">Document root: <code><?= htmlspecialchars(__DIR__) ?></code></p>
</main>
</body>
</html>
`
