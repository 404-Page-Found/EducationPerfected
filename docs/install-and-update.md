# Install, update and uninstall

[Documentation](README.md) / [Project README](../README.md)

Choose the desktop app for an embedded browser and native controls, or the CLI for terminal commands and a separate browser. Current `main` can include fixes not yet in a published release. Read the release notes for the version you download.

## Installation

### Installer (recommended)

Installers are available in the published [v2026.11.22 release](https://github.com/404-Page-Found/EducationPerfected/releases/tag/v2026.11.22). The [Publish workflow](../.github/workflows/publish.yml) attaches them to the release. The gates in [release/README.md](../release/README.md) still apply.

Choose the installer for your platform:

**Windows:**
1. Download `educationperfected-windows-x64-setup.exe` and `SHA256SUMS` from the release. Check the download against `SHA256SUMS` before running it.
2. Run the installer (per-user, no admin). Select **Add EducationPerfected to your PATH**. Builds are unsigned; if SmartScreen shows "Windows protected your PC", choose **More info -> Run anyway**.
3. Open **EducationPerfected** from the Start menu. Its browser is installed with the app, with no separate terminal setup or download. Save a login in the app if you want, or skip and sign in manually.
4. The `educationperfected` terminal command is optional. CLI-only use has its own consent-based Chrome download on first setup.

**macOS:**
1. Download `educationperfected-macos-arm64.pkg` (Apple Silicon) or `educationperfected-macos-x64.pkg` (Intel) and `SHA256SUMS` from the release. Check the download against `SHA256SUMS` before running it.
2. Run the installer; it puts `educationperfected` in `/usr/local/bin`, which is already on your PATH. Builds are unsigned; right-click the `.pkg` and choose **Open**.
3. Open **EducationPerfected** from Applications. Its browser is already installed. The app offers an optional saved login before opening its sign-in page.
4. The `educationperfected` terminal command stays available for CLI use.

**Linux:**
1. Download the `.deb` or `.rpm` for your architecture and `SHA256SUMS` from the release. Check the download against `SHA256SUMS` before installing it.
2. Install the package with your package manager (for example `sudo apt install ./educationperfected_2026.11.22_amd64.deb` or `sudo dnf install ./educationperfected-2026.11.22-1.x86_64.rpm`). It puts `educationperfected` in `/usr/bin`, which is already on your PATH.
3. Open **EducationPerfected** from your desktop's application menu. Its browser is already installed. The app offers an optional saved login before opening its sign-in page.
4. The `educationperfected` terminal command stays available for CLI use.

**Other ways to install:**
- **Install scripts:** download `install.ps1` (Windows) or `install.sh` (macOS/Linux) from the release. After checking the script, run `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1` in PowerShell (bypass applies only to that process) or `sh install.sh` in a terminal. Follow the script's PATH instructions.
- **npm:** run `npm install -g --allow-scripts=educationperfected educationperfected` (requires Node.js). The `--allow-scripts` opt-in is needed on npm 12+; the postinstall downloads the platform binary and verifies it against the release's `SHA256SUMS`. See [npm/educationperfected/README.md](../npm/educationperfected/README.md) for the npm package.

For the CLI-only install scripts or npm package, run `educationperfected setup`, then `educationperfected`. Desktop installer users do not need terminal setup. The install scripts and npm package verify the binary download against the release's `SHA256SUMS`; check manual downloads against it yourself.

Raw platform binaries are also included for advanced use. They are not added to PATH. On macOS/Linux, run `chmod +x <filename>` first; on macOS, remove quarantine with `xattr -d com.apple.quarantine <filename>` if blocked. Run the raw file by its path for setup and normal use: on Windows, `.\educationperfected-windows-x64.exe setup` then `.\educationperfected-windows-x64.exe`; on macOS, `./educationperfected-macos-arm64 setup` then `./educationperfected-macos-arm64` (use the matching filename on Intel or Linux).

### From a source ZIP or checkout

Requires Node.js 22.12 or newer. Download the full `main` source ZIP from the [repository](https://github.com/404-Page-Found/EducationPerfected), extract it into a new folder, then open a terminal in that folder:

```sh
npm ci
npm run app
```

These steps apply to Windows, macOS and Linux. On Windows, open PowerShell or Command Prompt in the extracted folder. Keep the whole repository together. The desktop app embeds its browser; it does not need CLI browser setup.

For terminal use instead, run `npm run cli`. Puppeteer's install script normally downloads the CLI browser during `npm ci`. If it was skipped, run `npx puppeteer browsers install chrome`. Saved-login and environment-variable setup are in the [developer guide](developer-guide.md#cli-credential-setup-source-build). Sign in manually for school SSO, Google, Microsoft, Clever or a CAPTCHA.

## Update

### Installed desktop app

Use the update control in App settings. It verifies the download against the release checksums and hands off to the OS installer. Windows uses the setup installer, macOS opens the package installer, and Linux uses the package manager or shows the exact sudo command when desktop elevation is unavailable. The installer updates the app and CLI together. A source/development copy does not enable installed-app updates.

### Source ZIP or checkout

Download the full updated source ZIP into a new folder, then run `npm ci` and `npm run app` there. Do not copy only `index.js` over an older tree. A Git checkout can pull the intended revision and run `npm ci` before restarting.

### Terminal-only installation

Use `educationperfected update`. Keep the install method in mind: standalone executables, scripts and npm remain CLI-only. For installed maintenance details, see [runtime storage](../release/runtime-storage.md).

### Upgrading a Windows CLI-only installation

If updating from v2026.11.16 reports v2026.11.22 but the Start-menu app still opens a terminal and a separate browser, the old updater replaced only the CLI. It did not install the desktop app or update the shortcut. The desktop app first shipped in v2026.11.22. Run the Windows setup installer from the published v2026.11.22 release (or a later stable release) once, over the existing installation. Do not uninstall first. Open EducationPerfected from the Start menu afterward, not the `educationperfected.exe` CLI in the install folder.

Newer CLI builds use the full setup installer for `educationperfected update` on Windows setup installations, upgrading the desktop app and CLI together. If a previous CLI-only update left the desktop app missing, the command can reinstall the same release to repair it. Standalone executables and PowerShell/npm installations remain CLI-only.

## Uninstall

Uninstall the app from your OS or package manager, the same as any other installed program:

- **Windows:** **Settings > Apps > Installed apps > EducationPerfected > Uninstall**. The uninstaller removes the app, the `educationperfected` command, the shortcuts and the PATH entry, then asks about the saved login and app data (each kept unless you choose to remove it).
- **macOS:** move **EducationPerfected** from Applications to the Bin.
- **Linux:** remove the package with your package manager (for example `sudo apt remove educationperfected` or `sudo rpm -e educationperfected`), or from your desktop's software center.

The terminal command `educationperfected uninstall` handles removal prompts for each install method. It asks about each item - the program itself, the saved login, app data and downloaded browsers - and keeps each one unless you choose to remove it (the Windows setup exe's own uninstaller asks the same questions instead). Unsafe, unowned or still-active browser caches and app data are retained, with an incomplete-removal message. Close all copies and inspect the reported retained paths before removing anything by hand. If you also removed the program, reinstall it first to retry cleanup through `educationperfected uninstall`, or download the matching raw binary and run `uninstall` by its file path. Use it for installs without an OS entry (install script or npm), and on macOS/Linux when you also want the command and app data gone. A raw binary that is not on your PATH runs it by its file path instead (for example, `.\educationperfected-windows-x64.exe uninstall` or `./educationperfected-macos-arm64 uninstall`).

