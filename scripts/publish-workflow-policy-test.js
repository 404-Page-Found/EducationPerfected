// Fixed repository workflow source only; no YAML execution or external actions.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../.github/workflows/publish.yml'),'utf8');
for(const required of [
 'name: Publish','workflow_dispatch:','tag:','types: [published]','contents: write','actions: read',
 // Least privilege: nothing at top level; contents: write only where drafts or assets demand it.
 'permissions: {}',
 'releases?per_page=100','--paginate','select(.tag_name == $t)','.draft','.assets | length','.target_commitish','Not Found',
 'release-bundle-v','workflow_run.head_sha','.github/workflows/release-bundle-staging.yml','.conclusion',
 'sha256sum -c SHA256SUMS','20 payloads + SHA256SUMS','%{redirect_url}',
 'gh release upload "$TAG" -- *','Publication stays manual',
 'already has $assets assets; remove them manually to re-attach',
 'gained $assets assets since the run started; refusing to attach','leaving it untouched',
 // The release's own commit drives the build; a branch target is resolved once, never followed.
 'main moving later does not','retarget this run','ref: ${{ needs.plan.outputs.sha }}',
 'package.json at $sha is version','GITHUB_SHA="$RESOLVED_SHA"',
 // Build path: five validated native candidates, byte-identical assembly.
 'build-downloadable','downloadable-candidate-','persist-credentials: false',
 'byte-identical','20 payload files','THIRD-PARTY-NOTICES-$target.zip',
 'educationperfected-windows-x64-setup.exe','retention-days: 90','if-no-files-found: error',
 'attach=true','bundle_id','label=$version-validation.1','draft=$draft',
 // npm publication: last job, live releases only, byte-verified tarball,
 // double-publish safe, explicit credentials, recoverable on failure.
 'npm-publish:','id-token: write','NPM_TOKEN','--provenance','--access public',
 'gh release download "$TAG"','already on the registry; skipping publish',
 'Re-run failed jobs','--ignore-scripts npm@12.2.2','vars.NPM_TRUSTED_PUBLISHING',
])assert.ok(source.includes(required),required);
assert.ok(!source.includes('not a draft; refusing'),'a zero-asset published release is accepted for recovery');
assert.ok(!source.includes('release/release-notes-'),'release notes are GitHub-generated; no hand-written notes file is bundled');
assert.ok(!source.includes('releases/tags/$TAG'),'the by-tag endpoint 404s on draft releases, the primary path; resolve via the releases list');
assert.ok(!source.includes('releases/tags/'),'no release-by-tag lookups anywhere: drafts are invisible to that endpoint');
assert.ok(!source.includes('--clobber'),'never replaces assets');
assert.doesNotMatch(source,/pull_request_target|git push|gh release create|gh release edit|gh release publish|gh release delete|types: \[created|softprops|ncipollo/);
for(const line of source.split('\n'))if(line.includes('uses:'))assert.match(line,/\/[a-z0-9-]+@[a-f0-9]{40}(?:\s|$)/,'pinned action: '+line);
assert.ok(require('../package.json').scripts['test:phase3'].includes('publish-workflow-policy-test.js'),'wired into test:phase3');
console.log('Publish workflow: one button resolves the release commit, attaches a verified staged bundle or builds and validates from that commit, attaches only to zero-asset releases, refuses any release that has assets; never tags, edits or publishes. npm-publish then puts the byte-verified tarball on the registry once the release is live, skipping versions already published.');
