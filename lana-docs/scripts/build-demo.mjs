// Copies the built log viewer, the demo host and the sample log into static/demo for the homepage live demo.
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';

const viewerOut = new URL('../../lana/out/', import.meta.url);
const demoSrc = new URL('../demo/', import.meta.url);
const sampleLog = new URL('../../sample-app/debug-logs/sample-log.log', import.meta.url);
const dest = new URL('../static/demo/', import.meta.url);
const BODY = '<body>';

const built = await readdir(viewerOut).catch(() => []);
if (!built.includes('bundle.js') || !built.includes('index.html')) {
  console.error('build-demo: lana/out has no log viewer. Run "pnpm build" at the repo root first.');
  process.exit(1);
}

const html = await readFile(new URL('index.html', viewerOut), 'utf8');
if (!html.includes(BODY)) {
  console.error(`build-demo: ${BODY} not found in lana/out/index.html, so the host cannot load.`);
  process.exit(1);
}

// The getConfig reply, built from the setting defaults the way lana's AppConfig.getConfig builds it.
const lanaPackage = JSON.parse(
  await readFile(new URL('../../lana/package.json', import.meta.url), 'utf8'),
);
const settings = {};
for (const section of [lanaPackage.contributes.configuration].flat()) {
  for (const [key, { default: value }] of Object.entries(section.properties)) {
    const path = key.split('.').slice(1);
    const leaf = path.pop();
    let node = settings;
    for (const part of path) {
      node = node[part] ??= {};
    }
    node[leaf] = value;
  }
}
const columns = { columnView: 'General', columnOverrides: {} };
settings.timeline.customThemes = {};
Object.assign(settings.callTree, columns);
settings.database = { soql: columns, dml: columns, sosl: columns };
// The Inspector is open in the screenshot the demo replaces.
Object.assign(settings.inspector, {
  collapsed: {},
  sectionOrder: {},
  hiddenSections: {},
  visible: true,
});

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

const viewerFiles = built.filter(
  (file) => file === 'bundle.js' || file.startsWith('log-viewer-') || file.startsWith('codicon.'),
);
const writes = [
  ...viewerFiles.map((file) => copyFile(new URL(file, viewerOut), new URL(file, dest))),
  ...['host.js', 'vscode-themes.js'].map((file) =>
    copyFile(new URL(file, demoSrc), new URL(file, dest)),
  ),
  copyFile(sampleLog, new URL('sample-log.log', dest)),
  writeFile(new URL('settings.json', dest), JSON.stringify(settings)),
  // Classic scripts at the top of <body> run before the deferred viewer bundle, with <body> to theme.
  writeFile(
    // Not index.html: with trailingSlash false, /demo/ redirects to /demo and breaks relative URLs.
    new URL('viewer.html', dest),
    html.replace(
      BODY,
      `${BODY}\n    <script src="vscode-themes.js"></script>\n    <script src="host.js"></script>`,
    ),
  ),
];
await Promise.all(writes);

console.log(`build-demo: copied ${writes.length} files to static/demo`);
