"use strict";
// Points the hero button at the installer matching the visitor's OS and
// architecture. Detection runs entirely in the browser; nothing is sent
// anywhere, and when the platform cannot be detected the button keeps its
// default behaviour of scrolling to the download section.
(function () {
  var link = document.getElementById("hero-download");
  var label = document.getElementById("hero-download-label");
  if (!link || !label) return;

  var RELEASES = "https://github.com/404-Page-Found/EducationPerfected/releases";
  var WINDOWS_X64 =
    RELEASES + "/latest/download/educationperfected-windows-x64-setup.exe";
  var MACOS_ARM64 =
    RELEASES + "/latest/download/educationperfected-macos-arm64.pkg";
  var MACOS_X64 =
    RELEASES + "/latest/download/educationperfected-macos-x64.pkg";
  // Linux filenames embed the version, so these stay pinned to one release
  // tag and are bumped with each release (see release/README.md).
  var LINUX_TAG = "v2026.11.22";
  var LINUX_DEB_X64 =
    RELEASES +
    "/download/" +
    LINUX_TAG +
    "/educationperfected_" +
    LINUX_TAG.slice(1) +
    "_amd64.deb";
  var LINUX_DEB_ARM64 =
    RELEASES +
    "/download/" +
    LINUX_TAG +
    "/educationperfected_" +
    LINUX_TAG.slice(1) +
    "_arm64.deb";

  function detectOS() {
    var platform =
      (navigator.userAgentData && navigator.userAgentData.platform) ||
      navigator.platform ||
      "";
    var ua = navigator.userAgent || "";
    if (/iphone|ipad|ipod|android/i.test(ua)) return null;
    if (/windows/i.test(platform) || /windows/i.test(ua)) return "windows";
    if (/mac/i.test(platform) || /macintosh|mac os x/i.test(ua)) return "macos";
    if (/linux/i.test(platform) || /linux/i.test(ua)) return "linux";
    return null;
  }

  function detectArm64(done) {
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      navigator.userAgentData.getHighEntropyValues(["architecture"]).then(
        function (values) {
          if (values.architecture === "arm") return done(true);
          if (values.architecture === "x86") return done(false);
          done(null);
        },
        function () {
          done(null);
        },
      );
      return;
    }
    done(null);
  }

  function isAppleSilicon() {
    // macOS user agents always claim "Intel", even on Apple Silicon, so the
    // WebGL renderer string is the only script-visible hint at the real chip.
    try {
      var canvas = document.createElement("canvas");
      var gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) return null;
      var info = gl.getExtension("WEBGL_debug_renderer_info");
      var renderer = info
        ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
      if (!renderer) return null;
      if (/apple/i.test(renderer)) return true;
      if (/intel|amd|radeon|nvidia/i.test(renderer)) return false;
      return null;
    } catch (error) {
      return null;
    }
  }

  function apply(href, text) {
    link.href = href;
    label.textContent = text;
  }

  var os = detectOS();
  if (os === "windows") {
    apply(WINDOWS_X64, "Download for Windows");
  } else if (os === "macos") {
    detectArm64(function (arm64) {
      if (arm64 === null) arm64 = isAppleSilicon();
      if (arm64 === null) arm64 = true; // Macs sold since late 2020 are Apple Silicon.
      if (arm64) apply(MACOS_ARM64, "Download for macOS (Apple Silicon)");
      else apply(MACOS_X64, "Download for macOS (Intel)");
    });
  } else if (os === "linux") {
    detectArm64(function (arm64) {
      if (arm64 === true) apply(LINUX_DEB_ARM64, "Download for Linux (.deb, ARM64)");
      else apply(LINUX_DEB_X64, "Download for Linux (.deb, x64)");
    });
  }
})();
