const fs = require('fs');
const path = require('path');

const files = [
  'tests/phase3-history-rollback.test.ts',
  'tests/phase3-manifest.test.ts',
  'tests/phase3-profiles.test.ts',
  'tests/phase3-workspace.test.ts',
  'tests/safety.test.ts'
];

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  let content = fs.readFileSync(f, 'utf-8');
  content = content.replace(/const trackingRoot = getTrackingRoot\(\);/g, 'const trackingRoot = await getTrackingRoot();');
  content = content.replace(/WorkspaceHistoryManager\.getHistory\(\)/g, 'await WorkspaceHistoryManager.getHistory()');
  content = content.replace(/loadWorkspaceManifest\(/g, 'await loadWorkspaceManifest(');
  content = content.replace(/initWorkspaceManifest\(/g, 'await initWorkspaceManifest(');
  content = content.replace(/validatePath\(/g, 'await validatePath(');
  content = content.replace(/test\('([^']+)', \(\) => \{/g, "test('$1', async () => {");
  fs.writeFileSync(f, content);
}
console.log('Fixed tests');
