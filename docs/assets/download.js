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
  var LATEST_RELEASE_API =
    "https://api.github.com/repos/404-Page-Found/EducationPerfected/releases/latest";
  var WINDOWS_X64 =
    RELEASES + "/latest/download/educationperfected-windows-x64-setup.exe";
  var MACOS_ARM64 =
    RELEASES + "/latest/download/educationperfected-macos-arm64.pkg";
  var MACOS_X64 =
    RELEASES + "/latest/download/educationperfected-macos-x64.pkg";
  // Linux filenames embed the version. The pinned tag is only the fallback
  // for when the latest-release lookup below fails; the page resolves the
  // current release at load time, so releases no longer bump this pin.
  var LINUX_TAG = "v2026.11.22";

  function linuxPackages(tag) {
    var version = tag.slice(1);
    return {
      "linux-deb-x64": "educationperfected_" + version + "_amd64.deb",
      "linux-deb-arm64": "educationperfected_" + version + "_arm64.deb",
      "linux-rpm-x64": "educationperfected-" + version + "-1.x86_64.rpm",
      "linux-rpm-arm64": "educationperfected-" + version + "-1.aarch64.rpm",
    };
  }

  function linuxUrl(tag, file) {
    return RELEASES + "/download/" + tag + "/" + file;
  }

  // The resolved tag is cached briefly so repeat views don't spend the
  // visitor's unauthenticated API quota (60 requests/hour per IP).
  var TAG_CACHE_KEY = "ep-latest-release-tag";
  var TAG_CACHE_MS = 60 * 60 * 1000;

  function readCachedTag() {
    try {
      var entry = JSON.parse(window.localStorage.getItem(TAG_CACHE_KEY));
      if (
        entry &&
        /^v\d+\.\d+\.\d+$/.test(entry.tag) &&
        Date.now() - entry.at < TAG_CACHE_MS
      ) {
        return entry.tag;
      }
    } catch (error) {
      // Storage can be unavailable (private mode); fall through to the API.
    }
    return null;
  }

  // Resolves the newest published release tag through GitHub's public API.
  // Any failure keeps the pinned fallback links, which still download.
  function fetchLatestTag(done) {
    var cached = readCachedTag();
    if (cached) return done(cached);
    if (!window.fetch) return done(null);
    fetch(LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
    }).then(
      function (response) {
        if (!response.ok) return done(null);
        response.json().then(
          function (data) {
            var tag = data && data.tag_name;
            if (typeof tag !== "string" || !/^v\d+\.\d+\.\d+$/.test(tag)) {
              return done(null);
            }
            // A release can be published before its assets finish attaching;
            // only accept the tag once all four Linux packages exist.
            var packages = linuxPackages(tag);
            var assets = Array.isArray(data.assets) ? data.assets : [];
            var names = {};
            for (var i = 0; i < assets.length; i++) {
              names[assets[i] && assets[i].name] = true;
            }
            for (var id in packages) {
              if (!names[packages[id]]) return done(null);
            }
            try {
              window.localStorage.setItem(
                TAG_CACHE_KEY,
                JSON.stringify({ tag: tag, at: Date.now() }),
              );
            } catch (error) {
              // Caching is best-effort; the resolved tag still applies.
            }
            done(tag);
          },
          function () {
            done(null);
          },
        );
      },
      function () {
        done(null);
      },
    );
  }

  // Points the Linux package cards at the resolved release: the download
  // button and the filename shown above it.
  function updateLinuxCards(tag) {
    var packages = linuxPackages(tag);
    for (var id in packages) {
      var anchor = document.getElementById(id);
      if (!anchor) continue;
      var file = packages[id];
      anchor.href = linuxUrl(tag, file);
      var card = anchor.parentNode;
      var code = card ? card.querySelector("code") : null;
      if (code) code.textContent = file;
    }
  }

  function detectOS() {
    var platform =
      (navigator.userAgentData && navigator.userAgentData.platform) ||
      navigator.platform ||
      "";
    var ua = navigator.userAgent || "";
    if (/iphone|ipad|ipod|android/i.test(ua)) return null;
    if (/windows/i.test(platform) || /windows/i.test(ua)) return "windows";
    if (/mac/i.test(platform) || /macintosh|mac os x/i.test(ua)) {
      // iPadOS reports a Macintosh platform; leave tablets on the fallback.
      if (navigator.maxTouchPoints > 2) return null;
      return "macos";
    }
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

  var linuxTag = LINUX_TAG; // fallback until the latest-release lookup lands

  function applyLinuxHero(arm64) {
    var packages = linuxPackages(linuxTag);
    if (arm64 === true) {
      apply(
        linuxUrl(linuxTag, packages["linux-deb-arm64"]),
        "Download for Linux (.deb, ARM64)",
      );
    } else {
      apply(
        linuxUrl(linuxTag, packages["linux-deb-x64"]),
        "Download for Linux (.deb, x64)",
      );
    }
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
    detectArm64(applyLinuxHero);
  }

  // Fresh Linux links for everyone, whatever OS the hero detected.
  fetchLatestTag(function (tag) {
    if (!tag || tag === linuxTag) return;
    linuxTag = tag;
    updateLinuxCards(tag);
    if (os === "linux") detectArm64(applyLinuxHero);
  });
})();
