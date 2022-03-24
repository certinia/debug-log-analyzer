# Contributing

🎉🥳 Thank you for contributing 🥳🎉  
Please read and follow the [code of conduct](./CODE_OF_CONTDUCT) whilst interating with this project.

First things first, before raising an issue check the [open issues](https://github.com/financialforcedev/debug-log-analyzer/issues), there may already be something similar to what you are looking for.  
If there is not, open an issue before contributing, it allows us to provide help and advice or just avoid duplicate effort.

## Getting the Code

1. Create a fork of the project
2. Clone your fork `git clone git@github.com:<username>/debug-log-analyzer.git`
3. Create a topic branch in your fork from main e.g (`feat-11-some-description` or `bug-11-some-description`)
4. Edit the code in your fork.
5. Create a pull request back to main, we will suggest any changes and get it merged.

## Build

In the directory you cloned the project to

```zsh
cd lana
npm ci
npm run compile
```

> NOTE: This will rebuild the whole project, to build only the `lana` folder use `npm run local-compile` and `npm run log-viewer` for the `log-viewer` folder.

## Tests

```zsh
cd log-viewer
npm run test
```

## Package

To create a VSIX (VSCode install bundle)

```zsh
vsce package
```
