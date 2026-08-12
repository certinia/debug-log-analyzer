import fs from 'node:fs';

const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
const nightly = fs.readFileSync('.github/workflows/nightly.yml', 'utf8');
const publish = fs.readFileSync('.github/workflows/publish.yml', 'utf8');
const promotePrerelease = fs.readFileSync('.github/workflows/promote-prerelease.yml', 'utf8');
const promoteStable = fs.readFileSync('.github/workflows/promote-stable.yml', 'utf8');
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

for (const requiredText of [
  'workflow_dispatch:',
  "#   - cron: '0 7 * * 3'",
  'uses: salesforcecli/github-workflows/.github/workflows/vscode-promote-prerelease.yml@ph/W-23832274-pnpm-stable-promotion',
  "min-tag-age-days: ${{ inputs.min-tag-age-days || '7' }}",
  "vsix-name-pattern: 'lana-*.vsix'",
  "exclude-web-vsix: 'true'",
  'extension-name: lana',
  "dry-run: ${{ inputs.dry-run && 'true' || 'false' }}",
  'secrets: inherit',
]) {
  if (!promotePrerelease.includes(requiredText)) {
    throw new Error(`Expected pre-release promotion workflow to include \`${requiredText}\`.`);
  }
}

if (/^  schedule:/m.test(promotePrerelease)) {
  throw new Error('Pre-release promotion schedule must remain disabled.');
}

for (const requiredText of [
  'workflow_dispatch:',
  "#     - cron: '0 6 * * 3'",
  'uses: salesforcecli/github-workflows/.github/workflows/vscode-promote-stable.yml@ph/W-23832274-pnpm-stable-promotion',
  'extension-name: lana',
  "vsix-name-pattern: 'lana-*.vsix'",
  "exclude-web-vsix: 'true'",
  'extensions-root: .',
  "node-version: '24'",
  'package-manager: pnpm',
  "package-manager-version: '10'",
  'cache-dependency-path: pnpm-lock.yaml',
  'lockfile-path: pnpm-lock.yaml',
  'install-command: pnpm run ci:install',
  'required-checks: E2E',
  "dry-run: ${{ inputs.dry-run && 'true' || 'false' }}",
  'secrets: inherit',
]) {
  if (!promoteStable.includes(requiredText)) {
    throw new Error(`Expected stable promotion workflow to include \`${requiredText}\`.`);
  }
}

if (/^  schedule:/m.test(promoteStable)) {
  throw new Error('Stable promotion schedule must remain disabled.');
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

for (const requiredText of [
  "#   - cron: '0 4 * * *'",
  'uses: salesforcecli/github-workflows/.github/workflows/vscode-publish-extensions.yml@ph/W-23832274-pnpm-stable-promotion',
  'extensions: lana',
  "pre-release: 'true'",
  'branch: main',
  'nightly: true',
  "version-bump: 'auto'",
  'extensions-root: .',
  'package-manager: pnpm',
  "exclude-web-vsix: 'true'",
  'publish-web-vsix: false',
  "dry-run: ${{ inputs.dry-run && 'true' || 'false' }}",
]) {
  if (!nightly.includes(requiredText)) {
    throw new Error(`Expected nightly release workflow to include \`${requiredText}\`.`);
  }
}

if (!nightly.includes('default: true')) {
  throw new Error('Manual nightly releases must default to dry-run mode.');
}

if (/^  schedule:/m.test(nightly)) {
  throw new Error('Nightly release schedule must remain disabled.');
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
