# educationperfected

Installs the verified EducationPerfected platform binary from the project's
GitHub releases (checksum-verified against the release's SHA256SUMS).

```
npm install -g --allow-scripts=educationperfected educationperfected
educationperfected setup
```

The `--allow-scripts` opt-in is needed on npm 12+, which blocks dependency
install scripts by default; the postinstall is what downloads and verifies the
platform binary.

This package installs the command line only. The desktop app comes with the
per-OS installers (Windows setup exe, macOS .pkg, Linux .deb/.rpm) attached
to the same releases.

Source and releases: https://github.com/404-Page-Found/EducationPerfected
