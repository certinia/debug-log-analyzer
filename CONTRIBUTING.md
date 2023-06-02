# Contributing

🎉🥳 Thank you for contributing 🥳🎉\

Please read and follow the [code of conduct](./CODE_OF_CONTDUCT) whilst interacting with this project.

First things first, before raising an issue check the [open issues](https://github.com/certinia/debug-log-analyzer/issues), there may already be something similar to what you are looking for.
If there is not, open an issue before contributing, it allows us to provide help and advice or just avoid duplicate effort.

## Getting the Code

1. Create a fork of the project
2. Clone your fork `git clone git@github.com:<username>/debug-log-analyzer.git`
3. Create a topic branch in your fork from main e.g (`feat-some-description` or `bug-some-description`)
4. Edit the code in your fork.
5. Create a pull request back to main, we will suggest any changes and get it merged.

### Dependencies

From a terminal, where you have cloned the repository, execute the following command to install the required dependencies:

```zsh
npm ci
```

### Build

```zsh
npm run build
```

> NOTE: This will rebuild the whole project, to do a quick build (skipping minification) run `npm run build:dev`

### Watch

During development run the watch command to make builds for changes quickly. execute the following command:

```zsh
npm run watch
```

This will do a full build of the bundles and then watch for file changes in the `lana` and `log-viewer` source, compiling those changes incrementally, for a fast dev experience.

## Tests

```zsh
npm run test
```

## Package

To create a VSIX (VSCode install bundle)

```zsh
cd lana
vsce package --no-dependencies
```
