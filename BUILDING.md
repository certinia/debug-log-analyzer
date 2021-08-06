# Getting Started

The extension source code is written in [TypeScript](https://www.typescriptlang.org/). This is compiled into Javascript as part of the build process. To re-build from source install the prerequisites and then follow the building instructions. 

The lana directory contain the extension source code. The log-viewer directory contains the source code for the webview displayed by the extension. This includes the code to parse log files and display data such as the flamegraph.

## Prerequisites 

### Node.js v12 or above ([node](https://nodejs.org/en/))

### VS Code Extension Manager ([vsce](https://github.com/microsoft/vscode-vsce))

VSCE is only required to create .vsix files for distribution. It can be installed globally with
```sh
npm i -g vsce
```

# Development

To build use:

```sh
cd lana
npm ci
npm run compile
```

The compile run script (see package.xml) makes use of shell features that may not be availble on your OS. An alternative way to compile is:

```sh
cd log-viewer
npm ci
npm run build
cd ../lana
npm ci
tsc -p ./
```

Once compiled you can launch the extension directly from VSCode using the 'Run Extension' launch configuration.

# Packaging

You can package the extension using:

```sh
cd lana
vsce package
```

This command will automatically build the extension
