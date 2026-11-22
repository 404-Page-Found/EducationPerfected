"use strict";
// The site deliberately needs no dependencies or build step.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "docs/index.html"), "utf8").replace(/\s+/g, " ");
const css = fs.readFileSync(path.join(root, "docs/assets/site.css"), "utf8");
assert.match(html, /<!doctype html>/i);
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.equal((html.match(/<h1\b/g) || []).length, 1);
assert.match(html, /Content-Security-Policy/);
assert.match(html, /default-src 'none'/);
assert.doesNotMatch(html, /<(?:script|iframe|form|object|embed)\b/i);
const inlineHandler = /\son\w+\s*=/i;
assert.match(' onload = "bad()"', inlineHandler);
assert.match(' onerror="bad()"', inlineHandler);
assert.doesNotMatch(html, inlineHandler);
assert.doesNotMatch(css, /@import|url\s*\(/i);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
assert.equal(new Set(ids).size, ids.length, "unique anchor IDs");
const projectPath = (value) => value === "/404-Page-Found/EducationPerfected" || value.startsWith("/404-Page-Found/EducationPerfected/");
assert.equal(projectPath("/404-Page-Found/EducationPerfected-other"), false);
assert.equal(projectPath("/404-Page-Found/EducationPerfected"), true);
assert.equal(projectPath("/404-Page-Found/EducationPerfected/releases/latest"), true);
for (const [, value] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
  if (value === "#") continue;
  if (value.startsWith("#")) {
    assert.ok(ids.includes(value.slice(1)), `missing fragment ${value}`);
  } else if (value.startsWith("https:")) {
    const url = new URL(value);
    assert.equal(
      url.hostname,
      "github.com",
      `unexpected external host: ${value}`,
    );
    assert.ok(
      projectPath(url.pathname) ||
        url.pathname === "/akioweh/EducationPerfected",
    );
  } else {
    assert.ok(!value.includes("..") && !path.isAbsolute(value));
    assert.ok(
      fs.existsSync(path.join(root, "docs", value)),
      `missing local asset ${value}`,
    );
  }
}
assert.equal(
  fs.readFileSync(path.join(root, "docs/assets/logo.svg"), "utf8"),
  fs.readFileSync(
    path.join(root, "branding/educationperfected-logo.svg"),
    "utf8",
  ),
  "use the approved app logo unchanged",
);
assert.ok(fs.existsSync(path.join(root, "docs/.nojekyll")));
const platforms = html.match(/<article class="platform">[\s\S]*?<\/article>/g);
assert.equal(platforms.length, 3);
for (const [i, os] of ["Windows", "macOS", "Linux"].entries()) {
  assert.match(platforms[i], new RegExp(`<h3>${os}</h3>`));
  assert.match(platforms[i], /releases\/(?:latest\/download|download\/v[\d.]+)\/educationperfected[^"]*\.(?:exe|pkg|deb)"/, "direct installer download");
  assert.match(platforms[i], /<h4>Install<\/h4>/);
  assert.match(platforms[i], /<h4>Uninstall<\/h4>/);
  assert.match(platforms[i], /#installation/);
}
const stable = /releases\/latest\/download\/(educationperfected-(?:windows-x64-setup\.exe|macos-(?:arm64|x64)\.pkg))"/g;
assert.deepEqual([...html.matchAll(stable)].map((m) => m[1]).sort((a, b) => a.localeCompare(b)), ["educationperfected-macos-arm64.pkg", "educationperfected-macos-x64.pkg", "educationperfected-windows-x64-setup.exe"], "stable-name direct links for Windows and macOS");
const pinned = [...html.matchAll(/releases\/download\/(v[\d.]+)\/(educationperfected[^"]+)"/g)];
assert.equal(pinned.length, 4, "four Linux package links");
for (const [, tag, file] of pinned) {
  assert.ok(file.includes(tag.slice(1)), `Linux file matches its tag: ${file}`);
}
assert.equal(new Set(pinned.map((m) => m[1])).size, 1, "Linux links share one release tag");
assert.match(html, /not affiliated with Education Perfect/);
assert.match(html, /docs\/disclaimer.md/);
assert.match(html, /Dash has no end-to-end live verification/);
assert.match(html, /Main can contain fixes not yet in a published download/);
assert.match(html, /Assessments and unsupported shapes are refused/);
// Versioned filenames are allowed only inside the pinned Linux release URLs checked above.
assert.doesNotMatch(
  html.replace(/releases\/download\/v[\d.]+\//g, ""),
  /uninstall from (?:the app|Settings)|undetectable|guaranteed|v2026\./i,
);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /:focus-visible/);
assert.match(html, /class="skip" href="#main"/);
console.log(
  "Landing page: local assets, anchors, CSP/no scripts, approved branding, OS parity and honest status contracts passed.",
);
