# Getting Started

The extension source code is written in [TypeScript](https://www.typescriptlang.org/). This is compiled into Javascript as part of the build process. To re-build from source install the prerequisites and then follow the building instructions.

The lana directory contain the extension source code. The log-viewer directory contains the source code for the webview displayed by the extension. This includes the code to parse log files and display data such as the flame chart.

## Prerequisites

### Node.js v16 or above ([node](https://nodejs.org/en/))

### VS Code Extension Manager ([vsce](https://github.com/microsoft/vscode-vsce))

VSCE is only required to create .vsix files for distribution. It can be installed globally with

```zsh
npm i -g @vscode/vsce
```

## Local Development

### Dependencies

First remember to install node dependencies

```zsh
npm ci
```

### Build and bundle

Run the following command to do a quick build of the bundles. This will skip the minfication step.

```zsh
npm run build:dev
```

or to do a production ready build, use:

```zsh
npm run build
```

### Watch

During development run the watch command to make builds for changes quickly. execute the following command:

```zsh
npm run watch
```

This will do a full build of the bundles and then watch for file changes in the `lana` and `log-viewer` source, compiling those changes incrementally, for a fast dev experience.

### Run the extension

After the bundles have been created

- Open the debugger view (cmd/ctr + shift + d) or click the bug icon on the side bar
- Select "Run Extension" from the drop down then click the green play icon

This will launch another version of VSCode (Extension host) with the current extension enabled.

If watch is running simple refresh the extension host view with cmd/ctrl + r or by using the restart icon. If watch is not running first execute one of the build commands.

## Local Development (`log-viewer` standalone)

Only use the following if you do not want any of the VSCode specific features

Alternatively the log-viewer can be run in a web browser to speed development work.
This will not include the styles inherited from VSCode or include any VSCode functionality.
The debug log file path will need to specified by manually editing the `sample.log` value in `index.html`
To do this:

```zsh
npm ci
cd log-viewer
npm run debug
```

This will start a web server that you can access from any browser alongside a watch process that will recompile when source files are changed. The URL for the server is shown on the console. Use the "Launch Chrome' debug configuration to have VSCode launch and attach to Chrome for debugging.

## Packaging

You can package the extension using:

```zsh
npm ci
cd lana
vsce package --no-dependencies
```

This command will automatically build the extension
