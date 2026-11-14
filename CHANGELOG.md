# Changelog

## Unreleased

- Unified uninstall: every installer now writes an install record (`educationperfected-install.json`) and `uninstall` removes the program itself on every install method, after the existing per-item data/login/browser prompts (each still defaults to No). Windows setup exe runs its own uninstaller; npm runs `npm uninstall -g`; `.deb`/`.rpm` run the package manager with sudo; `.pkg` removes its files and forgets the receipt; install.sh/install.ps1/raw binaries delete what they wrote, including the install.ps1 PATH entry. Windows program removal finishes in a detached background helper after the CLI exits (a running program cannot delete itself) and writes a log to `%TEMP%\educationperfected-uninstall.log`. Installs without a record are detected from their location and reported as inferred. Per-OS removal paths are code-reviewed and synthetically tested but not yet verified on real machines of every platform.
