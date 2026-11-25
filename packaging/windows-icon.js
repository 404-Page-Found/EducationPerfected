// Applies the EducationPerfected icon and version identity to a built Windows
// executable. Pure-JS resource edit (resedit), so candidate lanes need no
// extra tooling. Runs after postject so it is the final exe mutation.
const fs = require('node:fs');
const resedit = require('resedit');

function applyWindowsIcon(executable, iconFile, appVersion) {
 const parts = String(appVersion).split('.').map(Number);
 if (parts.length !== 3 || parts.some(n => !Number.isInteger(n) || n < 0)) throw new Error('Windows icon step needs a three-part numeric version, got ' + appVersion);
 // The base node.exe ships signed; the SEA blob injection already voids that
 // signature, and these builds are unsigned by policy, so parsing proceeds
 // with the certificate ignored (the edit drops it).
 const exe = resedit.NtExecutable.from(fs.readFileSync(executable), { ignoreCert: true });
 const res = resedit.NtExecutableResource.from(exe);
 const icon = resedit.Data.IconFile.from(fs.readFileSync(iconFile));
 if (!icon.icons.length) throw new Error(iconFile + ' contains no icons');
 const groups = resedit.Resource.IconGroupEntry.fromEntries(res.entries);
 if (!groups.length) throw new Error('The base executable has no icon group to replace');
 resedit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groups[0].id, groups[0].lang, icon.icons.map(item => item.data));
 const versionInfos = resedit.Resource.VersionInfo.fromEntries(res.entries);
 if (versionInfos.length) {
  const vi = versionInfos[0];
  const lang = vi.lang;
  vi.setStringValues({ lang, codepage: 1200 }, {
   FileDescription: 'EducationPerfected',
   ProductName: 'EducationPerfected',
   CompanyName: '404-Page-Found',
   OriginalFilename: 'educationperfected.exe',
  });
  vi.setFileVersion(parts[0], parts[1], parts[2], 0, lang);
  vi.setProductVersion(parts[0], parts[1], parts[2], 0, lang);
  vi.outputToResourceEntries(res.entries);
 }
 res.outputResource(exe);
 fs.writeFileSync(executable, Buffer.from(exe.generate()));
 console.log('Windows executable icon applied: ' + executable);
}
module.exports = { applyWindowsIcon };
