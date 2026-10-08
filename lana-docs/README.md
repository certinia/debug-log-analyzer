# Apex Log Analyzer docs site

The docs site for Apex Log Analyzer, built with [Docusaurus](https://docusaurus.io/). It is published at <https://certinia.github.io/debug-log-analyzer/>.

Run the commands below from the repo root.

## Develop

```sh
pnpm install
pnpm --filter docs-site start
```

Most changes show in the browser without a restart.

## Live demo

The homepage demo runs the built log viewer on the sample log. To use it locally, build the viewer first:

```sh
pnpm build
pnpm --filter docs-site build:demo
```

`build:demo` copies the viewer, `demo/host.js` and the sample log into `static/demo`, which git ignores. Run it again after each viewer build. The site `build` runs it for you.

To demo another build, set `DEMO_VIEWER_ROOT` to a checkout that has a built `lana/out`.

## Build and test

```sh
pnpm --filter docs-site build
pnpm --filter docs-site serve
pnpm --filter docs-site test
```

- `build` fails on a broken link.
- `test` runs jest tests of the live demo: the homepage component, and `demo/host.js` against the commands the viewer sends. It needs no build or browser. Set `DEMO_VIEWER_ROOT` to check the host against another checkout's viewer.

CI runs the build and the tests on every pull request.

## Publish

The **Publish GitHub Pages Site** workflow publishes the site. It runs after each successful stable release, and you can run it by hand from the Actions tab.

- The docs come from `main`. To publish a text fix, merge it, then run the workflow by hand.
- The live demo runs the latest stable release of the viewer, so it never shows unreleased viewer code.

## Screenshots

See the screenshot policy in [`RELEASING.md`](../RELEASING.md).
