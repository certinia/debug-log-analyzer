# 🛠️ Developing the Apex Log Analyzer Extension

Welcome to the development guide for the **Apex Log Analyzer** VS Code extension! This document will walk you through the steps required to get started with the development environment, build the extension, and contribute to the project.

- The source code is written in [TypeScript](https://www.typescriptlang.org/).
- The lana directory contains the source code for the VS Code Extension.
- The log-viewer directory contains the source code for the webview displayed by the extension but does not depend on VSCode.

## 📚 Table of Contents

1. [Prerequisites](#-prerequisites)
2. [Setting Up the Development Environment](#-setting-up-the-development-environment)
3. [Building and Bundling](#-building-and-bundling)
4. [Running the Extension Locally](#-running-the-extension-locally)
5. [Packaging the Extension](#-packaging-the-extension)

## 🔧 Prerequisites

Before you start developing, make sure you have the following tools installed:

- **Node.js** v22 or above: [Install Node.js](https://nodejs.org/en/)
- **[pnpm](https://pnpm.io/)**: This package manager will be used for installing dependencies
- \*\*[VS Code](https://code.visualstudio.com/)

Once you’ve got these ready, you’re all set to get started! 🚀

## 👨‍💻 Setting Up the Development Environment

To get started, clone this repository and install the necessary dependencies.

1. **Create a fork of the repository first**
2. **Clone the repository:**

```zsh
git clone https://github.com/your-username/apex-log-analyzer.git
cd apex-log-analyzer
```

3. **Install dependencies:**

   Use [pnpm](https://pnpm.io/) to install project dependencies:

```zsh
pnpm i
```

## ⚙️ Building and Bundling

You can build the extension and prepare it for local development, run the watcher to re build automatically or production use. Here's how:

1. **Watch Build:**

   To build the extension without minification and then watch for file changes in the `lana` and `log-viewer` source, rebuilding incrementally, for a fast dev experience, use:

```bash
pnpm run watch
```

2. **Development Build:**

   To build the extension without minification (fast for local development), use:

```bash
pnpm run build:dev
```

3. **Production Build:**

   To create a production-ready build with minification, use:

```bash
pnpm run build
```

## 🚀 Running the Extension Locally

Once you’ve built the extension or run the watcher, you can run it inside a local VS Code instance for testing and development.

1. **Start the extension host:**
   - Open the **Run and Debug** panel in VS Code (CMD/CTRL + Shift + D).
   - Select **Run Extension** from the dropdown.
   - Click the green play button to launch a new VS Code window (the extension host).

2. **Refresh the extension host:**

   If you're using the **watch** mode (see below), refresh the extension host view by pressing CMD/CTRL + R or clicking the restart icon.

## 🧪 Testing Your Changes

Make sure your changes don’t break anything. If you’re working on a feature or bug fix that requires tests, be sure to add or update the relevant tests.

Run Tests Locally:
If you have added or modified tests, you can run them with:

```zsh
pnpm run test
```

or run the tests from the test explorer in VScode

Ensure all tests pass before submitting your pull request.

## 📦 Packaging the Extension

This is for information only packaging and releasing is handled in Github.
Once you're ready to package the extension for distribution:

1. Ensure that you’ve installed the dependencies:

```zsh
pnpm install
```

2. Package the extension:

```zsh
cd lana
vsce package --no-dependencies
```

This command will create a `.vsix` file that you can distribute or install locally.
