import fs from 'node:fs';

const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
const publish = fs.readFileSync('.github/workflows/publish.yml', 'utf8');
const e2e = fs.readFileSync('.github/workflows/e2e.yml', 'utf8');
const manifest = JSON.parse(fs.readFileSync('lana/package.json', 'utf8'));

const requiredPublishCommands = [
  ['package-command', 'vsce package --target web --no-dependencies'],
  ['prerelease-package-command', 'vsce package --pre-release --target web --no-dependencies'],
  ['web-package-command', 'vsce package --target web --no-dependencies'],
  ['web-prerelease-package-command', 'vsce package --target web --pre-release --no-dependencies'],
];

for (const [name, command] of requiredPublishCommands) {
  const match = publish.match(new RegExp(`^\\s{6}${name}: (.+)$`, 'm'));
  if (!match?.[1].includes(command)) {
    throw new Error(`Expected \`${name}\` to include \`${command}\`.`);
  }
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
