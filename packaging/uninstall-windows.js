// Windows program removal runs through a background PowerShell helper: a running
// executable cannot delete itself, and npm cannot remove the package directory
// of the running CLI. The helper waits for this process to exit, finishes the
// removal, appends to a small log and deletes itself.
const fs = require('node:fs'), path = require('node:path');

function psLiteral(value) {
    if (typeof value !== 'string' || !value) throw new Error('Uninstall helper paths must be non-empty strings');
    if (/[\r\n]/.test(value)) throw new Error('Uninstall helper paths must not contain newlines');
    return "'" + value.replace(/'/g, "''") + "'";
}

function psArray(values) {
    return '@(' + values.map(psLiteral).join(',') + ')';
}

// modes:
//  files - delete install-record files and shortcuts, remove PATH entries
//  npm   - run npm uninstall -g educationperfected
//  inno  - run the Inno uninstaller (it removes program, shortcuts, PATH and
//          asks about the saved login and app data itself)
function windowsUninstallHelperScript({ pid, mode, log, files = [], pathEntries = [], shortcuts = [], uninstaller = null, packageName = 'educationperfected' }) {
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('Uninstall helper needs the CLI process id');
    if (!['files', 'npm', 'inno'].includes(mode)) throw new Error('Unknown uninstall helper mode');
    const lines = [
        '$ErrorActionPreference = \'Continue\'',
        '$log = ' + psLiteral(log),
        'function Log($m) { Add-Content -LiteralPath $log -Value $m }',
        'Log "uninstall helper started (mode ' + mode + ', cli pid ' + pid + ')"',
        'Log "waiting for cli pid ' + pid + ' to exit (up to 600 seconds)"',
        'if (Get-Process -Id ' + pid + ' -ErrorAction SilentlyContinue) {',
        '  try { Wait-Process -Id ' + pid + ' -Timeout 600 -ErrorAction Stop } catch {',
        '    if (Get-Process -Id ' + pid + ' -ErrorAction SilentlyContinue) { Log "FAILED: CLI is still running; nothing removed"; Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue; exit 1 }',
        '  }',
        '}',
        'Log "CLI exited; starting removal"',
        'Start-Sleep -Seconds 2',
    ];
    if (mode === 'files') {
        // Directories are never deleted: the record lists files, and a stray
        // directory entry must not turn into a recursive removal.
        lines.push(
            'foreach ($f in ' + psArray(files) + ') { if (Test-Path -LiteralPath $f -PathType Container) { Log "skipped directory $f" } else { try { Remove-Item -LiteralPath $f -Force -ErrorAction Stop; Log "removed $f" } catch { Log "FAILED to remove ${f}: $($_.Exception.Message)" } } }',
        );
        if (pathEntries.length) {
            lines.push(
                '$remove = ' + psArray(pathEntries.map(entry => entry.toLowerCase())),
                '$current = [Environment]::GetEnvironmentVariable(\'Path\', \'User\')',
                'if ($current) {',
                '  $kept = @($current -split \';\' | Where-Object { $_ -and ($remove -notcontains $_.ToLower()) })',
                '  $updated = $kept -join \';\'',
                '  if ($updated -ne $current) {',
                '    try { [Microsoft.Win32.Registry]::SetValue(\'HKEY_CURRENT_USER\\Environment\', \'Path\', $updated, [Microsoft.Win32.RegistryValueKind]::ExpandString); Log "PATH entry removed" } catch { Log "FAILED to update user PATH: $($_.Exception.Message)" }',
                '  }',
                '}',
            );
        }
        if (shortcuts.length) {
            lines.push('foreach ($s in ' + psArray(shortcuts) + ') { try { Remove-Item -LiteralPath $s -Force -ErrorAction Stop; Log "removed shortcut $s" } catch { Log "FAILED to remove shortcut ${s}: $($_.Exception.Message)" } }');
        }
    } else if (mode === 'npm') {
        lines.push(
            '$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue',
            'if ($npm) {',
            '  & $npm.Source uninstall -g ' + packageName + ' 2>&1 | ForEach-Object { Log "$_" }',
            '  Log "npm uninstall exit code: $LASTEXITCODE"',
            '} else { Log "FAILED: npm not found on PATH; run: npm uninstall -g ' + packageName + '" }',
        );
    } else {
        if (!uninstaller) throw new Error('The inno uninstall helper needs the uninstaller path');
        lines.push(
            '$innoLog = $log + ".inno.log"',
            'Log "starting Inno uninstaller; native log: $innoLog"',
            `try { $p = Start-Process -FilePath ${psLiteral(uninstaller)} -ArgumentList ('/LOG="' + $innoLog + '"') -WorkingDirectory ${psLiteral(path.dirname(log))} -Wait -PassThru -ErrorAction Stop; Log "uninstaller exit code: $($p.ExitCode)" } catch { Log "FAILED to start the uninstaller: $($_.Exception.Message)" }`,
        );
    }
    lines.push(
        'Log "uninstall helper done"',
        'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue',
        '',
    );
    return lines.join('\r\n');
}

// powershell.exe is resolved through PATH, which a broken user PATH defeats;
// the Windows PowerShell 5.1 binary has a stable absolute location instead.
function resolvePowerShell(env = process.env) {
    const root = env.SystemRoot || env.windir;
    if (root && !/[\r\n]/.test(root)) {
        const full = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        if (fs.existsSync(full)) return full;
    }
    return 'powershell.exe';
}

// stdio is ignored, so spawn success or failure surfaces only through the
// 'spawn'/'error' events. Confirming the helper actually started before the
// caller reports a handoff (and quits) is what turns a silent no-op into a
// shown error.
function awaitHelperSpawn(child, log) {
    if (!child || typeof child.once !== 'function') return Promise.resolve();
    return new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); child.removeListener('spawn', onSpawn); child.removeListener('error', onError); };
        const onSpawn = () => { cleanup(); resolve(); };
        const onError = error => {
            cleanup();
            try { fs.appendFileSync(log, 'helper spawn failed: ' + error.message + '\n'); } catch { /* log is best-effort */ }
            reject(new Error('Could not start the uninstall helper (' + error.message + '). Nothing was removed.'));
        };
        const timer = setTimeout(() => { cleanup(); resolve(); }, 10000);
        if (typeof timer.unref === 'function') timer.unref();
        child.once('spawn', onSpawn);
        child.once('error', onError);
    });
}

async function waitForHelperReady(ready, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (!fs.existsSync(ready)) {
        if (Date.now() >= deadline) throw new Error('The uninstall helper did not become ready in time. It may still start removal after this program exits.');
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    fs.unlinkSync(ready);
}

async function startWindowsUninstallHelper({ pid, mode, log, files, pathEntries, shortcuts, uninstaller, tmp, env = process.env, spawnDetached, waitReady = waitForHelperReady }) {
    const helper = path.join(tmp, 'educationperfected-uninstall-' + pid + '-' + Date.now().toString(36) + '.ps1');
    // The BOM matters: Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI,
    // which mangles non-ASCII characters in install paths.
    const ready = helper + '.ready';
    const script = windowsUninstallHelperScript({ pid, mode, log, files, pathEntries, shortcuts, uninstaller });
    // The acknowledgement is written by the actual independent helper, not
    // the short-lived launcher. Keep the CLI/console alive until it arrives.
    fs.writeFileSync(helper, '\uFEFF' + 'Set-Content -LiteralPath ' + psLiteral(ready) + " -Value 'ready' -ErrorAction Stop\r\n" + script, { mode: 0o700 });
    const powershell = resolvePowerShell(env);
    // Start-Process creates the independent hidden window that a plain Node
    // child lacks. Do not use Node's detached console flag, which fails to run
    // PowerShell on the native lane. EncodedCommand avoids shell/path parsing.
    const argumentsText = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + helper + '"';
    const launch = 'Start-Process -FilePath ' + psLiteral(powershell) + ' -ArgumentList ' + psLiteral(argumentsText) + ' -WindowStyle Hidden -WorkingDirectory ' + psLiteral(tmp) + ' -ErrorAction Stop';
    const encoded = Buffer.from(launch, 'utf16le').toString('base64');
    const child = spawnDetached(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]);
    await awaitHelperSpawn(child, log);
    await waitReady(ready);
    return helper;
}

module.exports = { windowsUninstallHelperScript, startWindowsUninstallHelper, resolvePowerShell, awaitHelperSpawn, waitForHelperReady, psLiteral };
