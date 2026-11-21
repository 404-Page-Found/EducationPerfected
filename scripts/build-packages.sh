#!/usr/bin/env bash
# Build the per-platform packages (pkg/deb/rpm) around an already-validated
# candidate binary and its desktop app payload, then prove each package
# carries those exact bytes by expanding/extracting it and comparing the
# binary plus representative app files. Fails closed on any mismatch.
set -euo pipefail
target=$1; version=$2; src=$3; out=$4
test -f "$src"
payload="$4/app-payload"
test -d "$payload"
# Install-time setup runs the installed CLI's own browser-only setup step as
# the installing user (never root's home). A failed download (offline,
# interrupted) must not fail the install: the app's first-run wizard probes
# and offers the same download as the repair path.
read -r -d '' POSTINST <<'SCRIPT' || true
#!/bin/sh
# The installing user is who ran sudo; never guess another logged-in account -
# a wrong guess would download 200 MB into the wrong home. When the user
cannot be determined, skip: the app's first-run setup is the repair path.
user=${SUDO_USER:-}
home=$(getent passwd "$user" 2>/dev/null | cut -d: -f6)
if [ -n "$user" ] && [ "$user" != "root" ] && [ -n "$home" ]; then
  echo "EducationPerfected: downloading the pinned Chrome browser for $user (about 200 MB from Google; downloading accepts Google's terms)."
  su -s /bin/sh "$user" -c "HOME='$home' /usr/bin/educationperfected setup --browser-only" || echo "EducationPerfected: the browser download did not finish; the app's first-run setup will offer it again."
else
  echo "EducationPerfected: no non-root installing user found; the app's first-run setup will download the browser."
fi
exit 0
SCRIPT
case "$version" in (*[!0-9.]*|'') echo "version must be numeric parts"; exit 1;; esac
identical() { cmp -s "$1" "$2" || { echo "package payload is not byte-identical to the validated candidate: $1"; exit 1; }; }
mkdir -p "$out"
out=$(cd "$out" && pwd)
case "$target" in
  macos-*)
    command -v pkgbuild >/dev/null || { echo "pkgbuild not found on this runner"; exit 1; }
    payload_root=$(mktemp -d); scriptsdir=$(mktemp -d)
    mkdir -p "$payload_root/usr/local/bin" "$payload_root/Applications"
    install -m 755 "$src" "$payload_root/usr/local/bin/educationperfected"
    cp -R "$payload/EducationPerfected.app" "$payload_root/Applications/EducationPerfected.app"
    # Install record: uninstall reads this to remove exactly what this install created.
    printf '%s\n' '{"version":1,"method":"pkg","files":["/usr/local/bin/educationperfected","/usr/local/bin/educationperfected-install.json"],"directories":["/Applications/EducationPerfected.app"],"receipt":"com.404pf.educationperfected"}' > "$payload_root/usr/local/bin/educationperfected-install.json"
    # Install-time setup as the console user, never root.
    cat > "$scriptsdir/postinstall" <<'MACPOST'
#!/bin/bash
console_user=$(/usr/bin/stat -f %Su /dev/console)
if [ -n "$console_user" ] && [ "$console_user" != "root" ] && [ "$console_user" != "loginwindow" ]; then
  user_home=$(/usr/bin/dscl . -read "/Users/$console_user" NFSHomeDirectory 2>/dev/null | awk '{print $2}')
  if [ -n "$user_home" ]; then
    echo "EducationPerfected: downloading the pinned Chrome browser for $console_user (about 200 MB from Google; downloading accepts Google's terms)."
    /usr/bin/sudo -u "$console_user" HOME="$user_home" /usr/local/bin/educationperfected setup --browser-only || echo "EducationPerfected: the browser download did not finish; the app's first-run setup will offer it again."
  fi
else
  echo "EducationPerfected: no console user found; the app's first-run setup will download the browser."
fi
exit 0
MACPOST
    chmod 755 "$scriptsdir/postinstall"
    pkg="$out/educationperfected-$target.pkg"
    pkgbuild --root "$payload_root" --scripts "$scriptsdir" --identifier com.404pf.educationperfected --version "$version" --install-location / "$pkg" >/dev/null
    check=$(mktemp -d)
    pkgutil --expand-full "$pkg" "$check/expanded" >/dev/null
    identical "$check/expanded/Payload/usr/local/bin/educationperfected" "$src"
    identical "$check/expanded/Payload/Applications/EducationPerfected.app/Contents/Resources/app/main.cjs" "$payload/EducationPerfected.app/Contents/Resources/app/main.cjs"
    test -f "$check/expanded/Payload/Applications/EducationPerfected.app/Contents/MacOS/EducationPerfected"
    ;;
  linux-x64|linux-arm64)
    mkdir -p "$out"
case "$target" in
      linux-x64) debarch=amd64; rpmarch=x86_64;;
      linux-arm64) debarch=arm64; rpmarch=aarch64;;
    esac
    command -v dpkg-deb >/dev/null || { echo "dpkg-deb not found on this runner"; exit 1; }
    work=$(mktemp -d)
    # .desktop entry and icon shared by the deb and rpm payloads.
    desktop_file() {
      mkdir -p "$1/usr/share/applications" "$1/usr/share/icons/hicolor/256x256/apps" "$1/usr/lib/educationperfected"
      printf '[Desktop Entry]\nType=Application\nName=EducationPerfected\nComment=Education Perfect helper\nExec=/usr/lib/educationperfected/app/educationperfected-app\nIcon=educationperfected\nTerminal=false\nCategories=Education;\n' > "$1/usr/share/applications/educationperfected.desktop"
      cp "$payload/resources/branding/icon-256.png" "$1/usr/share/icons/hicolor/256x256/apps/educationperfected.png"
      cp -R "$payload" "$1/usr/lib/educationperfected/app"
      chmod 755 "$1/usr/lib/educationperfected/app/educationperfected-app"
    }
    # .deb
    mkdir -p "$work/deb/DEBIAN" "$work/deb/usr/bin"
    install -m 755 "$src" "$work/deb/usr/bin/educationperfected"
    desktop_file "$work/deb"
    # Install record: uninstall reads this to remove exactly what this install created.
    printf '%s\n' '{"version":1,"method":"deb","files":["/usr/bin/educationperfected","/usr/bin/educationperfected-install.json"],"directories":["/usr/lib/educationperfected"]}' > "$work/deb/usr/bin/educationperfected-install.json"
    printf 'Package: educationperfected\nVersion: %s\nArchitecture: %s\nMaintainer: 404-Page-Found\nDescription: Education Perfect helper CLI and desktop app (packaged binary)\n' "$version" "$debarch" > "$work/deb/DEBIAN/control"
    printf '%s\n' "$POSTINST" > "$work/deb/DEBIAN/postinst"; chmod 755 "$work/deb/DEBIAN/postinst"
    dpkg-deb --build --root-owner-group "$work/deb" "$out/educationperfected_${version}_${debarch}.deb" >/dev/null
    ex=$(mktemp -d)
    dpkg-deb --extract "$out/educationperfected_${version}_${debarch}.deb" "$ex"
    identical "$ex/usr/bin/educationperfected" "$src"
    identical "$ex/usr/lib/educationperfected/app/resources/app/main.cjs" "$payload/resources/app/main.cjs"
    test -f "$ex/usr/share/applications/educationperfected.desktop"
    # .rpm
    command -v rpmbuild >/dev/null || { echo "rpmbuild not found on this runner (apt-get install rpm)"; exit 1; }
    mkdir -p "$work/rpm/BUILD" "$work/rpm/RPMS" "$work/rpm/SOURCES" "$work/rpm/SPECS" "$work/rpm/SRPMS"
    cp "$src" "$work/rpm/SOURCES/educationperfected"
    rpm_payload=$(mktemp -d); desktop_file "$rpm_payload"
    (cd "$rpm_payload" && tar -cf "$work/rpm/SOURCES/app-payload.tar" usr)
    cat > "$work/rpm/SPECS/educationperfected.spec" <<SPEC
%global __os_install_post %{nil}
Name: educationperfected
Source0: educationperfected
Source1: app-payload.tar
Version: $version
Release: 1
Summary: Education Perfect helper CLI (packaged binary)
License: MIT
BuildArch: $rpmarch
%description
Packaged command-line app that opens Education Perfect in a dedicated browser window.
%install
mkdir -p %{buildroot}/usr/bin
install -m 755 %{SOURCE0} %{buildroot}/usr/bin/educationperfected
# Desktop app payload (app directory, .desktop entry, icon).
tar -xf %{SOURCE1} -C %{buildroot}
# Install record: uninstall reads this to remove exactly what this install created.
printf '%s\\n' '{"version":1,"method":"rpm","files":["/usr/bin/educationperfected","/usr/bin/educationperfected-install.json"],"directories":["/usr/lib/educationperfected"]}' > %{buildroot}/usr/bin/educationperfected-install.json
%post
$POSTINST
%files
/usr/bin/educationperfected
/usr/bin/educationperfected-install.json
/usr/lib/educationperfected
/usr/share/applications/educationperfected.desktop
/usr/share/icons/hicolor/256x256/apps/educationperfected.png
SPEC
    rpmbuild -bb --define "_topdir $work/rpm" "$work/rpm/SPECS/educationperfected.spec" >/dev/null
    rpm_file=$(find "$work/rpm/RPMS" -name '*.rpm' | head -1)
    test -n "$rpm_file"
    mv "$rpm_file" "$out/educationperfected-${version}-1.${rpmarch}.rpm"
    exr=$(mktemp -d)
    (cd "$exr" && rpm2cpio "$out/educationperfected-${version}-1.${rpmarch}.rpm" | cpio -idm --quiet)
    identical "$exr/usr/bin/educationperfected" "$src"
    identical "$exr/usr/lib/educationperfected/app/resources/app/main.cjs" "$payload/resources/app/main.cjs"
    test -f "$exr/usr/share/applications/educationperfected.desktop"
    ;;
  *)
    echo "no packages for target $target";;
esac
