// Windows program removal runs through a detached PowerShell helper: a running
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
        'try { Wait-Process -Id ' + pid + ' -Timeout 600 -ErrorAction Stop } catch { Log "cli wait ended: $($_.Exception.Message)" }',
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
            'try { $p = Start-Process -FilePath ' + psLiteral(uninstaller) + ' -Wait -PassThru -ErrorAction Stop; Log "uninstaller exit code: $($p.ExitCode)" } catch { Log "FAILED to start the uninstaller: $($_.Exception.Message)" }',
        );
    }
    lines.push(
        'Log "uninstall helper done"',
        'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue',
        '',
    );
    return lines.join('\r\n');
}

function startWindowsUninstallHelper({ pid, mode, log, files, pathEntries, shortcuts, uninstaller, tmp, spawnDetached }) {
    const helper = path.join(tmp, 'educationperfected-uninstall-' + pid + '-' + Date.now().toString(36) + '.ps1');
    fs.writeFileSync(helper, windowsUninstallHelperScript({ pid, mode, log, files, pathEntries, shortcuts, uninstaller }), { mode: 0o700 });
    const child = spawnDetached('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', helper]);
    // A failed spawn (no powershell.exe) emits 'error' asynchronously; without a
    // listener it would crash the CLI after uninstall already returned.
    if (child && typeof child.on === 'function') {
        child.on('error', error => { try { fs.appendFileSync(log, 'helper spawn failed: ' + error.message + '\n'); } catch { /* log is best-effort */ } });
    }
    return helper;
}

module.exports = { windowsUninstallHelperScript, startWindowsUninstallHelper, psLiteral };
