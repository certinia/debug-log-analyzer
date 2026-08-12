import fs from 'node:fs';

const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
const publish = fs.readFileSync('.github/workflows/publish.yml', 'utf8');
const e2e = fs.readFileSync('.github/workflows/e2e.yml', 'utf8');
const manifest = JSON.parse(fs.readFileSync('lana/package.json', 'utf8'));

function yamlSection(source, start, end) {
  const startIndex = source.indexOf(start);
  if (startIndex === -1) {
    return '';
  }

  const remainder = source.slice(startIndex + start.length);
  const endIndex = remainder.search(end);
  return endIndex === -1 ? remainder : remainder.slice(0, endIndex);
}

const publishJob = yamlSection(publish, '  publish:\n', /^  \w[^\n]*:\n/m);

const requiredPublishCommands = [
  ['package-command', 'vsce package --target web --no-dependencies'],
  ['prerelease-package-command', 'vsce package --pre-release --target web --no-dependencies'],
  ['web-package-command', 'vsce package --target web --no-dependencies'],
  ['web-prerelease-package-command', 'vsce package --target web --pre-release --no-dependencies'],
];

for (const [name, command] of requiredPublishCommands) {
  const match = publishJob.match(new RegExp(`^      ${name}: (.+)$`, 'm'));
  if (!match?.[1].includes(command)) {
    throw new Error(`Expected \`${name}\` to include \`${command}\`.`);
  }
}

for (const [name, requiredOutput] of [
  ['web-package-command', 'lana-web-$(node -p "require(\'./package.json\').version").vsix'],
  ['web-prerelease-package-command', 'lana-web-$(node -p "require(\'./package.json\').version").vsix'],
]) {
  const match = publishJob.match(new RegExp(`^      ${name}: (.+)$`, 'm'));
  if (!match?.[1].includes(requiredOutput)) {
    throw new Error(`Expected \`${name}\` to produce a \`lana-web-<version>.vsix\` artifact.`);
  }
}

if (!publishJob.includes('      artifact-glob: lana/*.vsix')) {
  throw new Error('Expected the publish workflow to upload Lana VSIX artifacts.');
}

if (!publishJob.includes('      publish-web-vsix: false')) {
  throw new Error('Expected the shared workflow CBWeb publish path to be disabled.');
}

const cbwebJob = yamlSection(
  publish,
  '  publish-to-cbweb-marketplace:\n',
  /^  \w[^\n]*:\n/m,
);
for (const requiredText of [
  'needs: publish',
  'uses: actions/download-artifact@v8',
  "find ./vsix-artifacts -type f -name 'lana-web-*.vsix'",
  'Expected exactly one web VSIX artifact',
  'MARKETPLACE_URL: ${{ vars.MARKETPLACE_URL }}',
  'MARKETPLACE_DEPLOY_TOKEN: ${{ secrets.MARKETPLACE_DEPLOY_TOKEN }}',
  'if: inputs.dry-run == false',
  'if: inputs.dry-run',
  'curl --fail-with-body',
  '${MARKETPLACE_URL}/api/internal/publish',
  '-F "vsix=@${VSIX_FILE}"',
]) {
  if (!cbwebJob.includes(requiredText)) {
    throw new Error(`Expected the CBWeb publish job to include \`${requiredText}\`.`);
  }
}

for (const prohibitedText of ['actions/checkout', 'setupNodeAndInstall', 'pnpm dlx @vscode/vsce']) {
  if (cbwebJob.includes(prohibitedText)) {
    throw new Error(`The CBWeb publish job must use the shared release artifact, not \`${prohibitedText}\`.`);
  }
}

const workflowDispatch = yamlSection(publish, '  workflow_dispatch:\n', /^  \w[^\n]*:/m);
if (!/    dry-run:\n        description: .+\n        required: true\n        default: true\n        type: boolean/.test(workflowDispatch)) {
  throw new Error('Expected release dry runs to be enabled by default.');
}

if (!ci.includes('vsce package --target web --no-dependencies')) {
  throw new Error('Expected CI package validation to use the web target.');
}

if (manifest.main !== 'dist/Main.js' || manifest.browser !== 'dist/web/Main.web.js') {
  throw new Error('Desktop and web extension entry points must remain available for development.');
}

if (
  !e2e.includes('  desktop:') ||
  !e2e.includes('os: [macos-latest, windows-latest]') ||
  !e2e.includes('run: pnpm run test:e2e:desktop')
) {
  throw new Error('Desktop E2E coverage must remain enabled.');
}
