# Branding

EducationPerfected's icon: a white italic E with a check mark on a blue rounded tile, designed by the project owner.

- `educationperfected-logo.svg` - the source asset (1024x1024 canvas; the tile sits at x=164 y=162, 696x698, with transparent padding around it). Keep the design as-is; derive, never redraw.
- `logo-1024.png` - full-canvas render (transparent padding kept) for general use.
- `icon-*.png` - the tile cropped to its bounds and square-scaled, 16 through 1024 px, for anything that needs a plain raster icon.
- `educationperfected.ico` - Windows icon (16/24/32/48/64/128/256, PNG-compressed entries). Embedded into `educationperfected.exe` at build time by `packaging/windows-icon.js` and used by the Inno setup script for the installer, wizard and shortcuts.
- `educationperfected.icns` - macOS icon set (16/32/128/256/512/1024), kept ready for the desktop app; the current macOS CLI binary carries no icon (bare CLI binaries have no standard icon slot).
- `../installer/wizard-image.bmp` (164x314) and `../installer/wizard-small.bmp` (55x55) - Inno wizard artwork.

Regenerate the derived files from the SVG with a full-fidelity renderer (gradients plus the drop-shadow filter, for example headless Chrome), crop to the tile rect, then export the PNG sizes and pack the .ico/.icns.
