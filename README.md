# Apex Log Analyzer for Salesforce

The Apex Log Analyzer is a Visual Studio Code extension to aid with Salesforce Apex debug log analysis. This extension was originally built by FinancialForce and has subsequently been shared as an open source community project. Salesforce and FinancialForce will make a best-faith effort to triage & moderate issues. This is a community project we are committed to, but that is not a guarantee of ongoing support from either organization. If you are interested in contributing, keep reading to get started! See the Visual Studio Code extension listing for more details on features and usage.

## Getting Started as a Contributor

### Prerequisites

- Java JDK 1.8
  - OpenJDK installed via brew is recommended
      ```sh
      brew tap adoptopenjdk/openjdk
      brew cask install adoptopenjdk8
      ```
  - For the correct java version to be used, JAVA_HOME must be set accordingly:
    - E.g. To always select JDK 1.8, add the following to your bash/zsh profile
      ```sh
      export JAVA_HOME=$(/usr/libexec/java_home -v 1.8)
      ```

- [Scala build tool](https://www.scala-sbt.org/)

```sh
brew install sbt
```

- VS Code Extension Manager ([vsce](https://github.com/microsoft/vscode-vsce))

```sh
npm i -g vsce
```

## Development

### Building

This project uses [SBT](https://www.scala-sbt.org/) to build each sub-project
and generate the VS Code extension.

Example SBT commands:

- `sbt build` (=== to `sbt lana/build`) - Build the VS Code extension with debugging support
- `sbt clean && sbt build` - Clear artifacts and do full rebuild
- `sbt prod:build` - Use production mode and configuration for full build

### Intellij

The Scala Intellij plugin has a number of useful features and integration that make it
highly recommended. Ensure you have installed and enabled it first.

The Intellij project files are ignored in this repository, so for a clean repo we need
to import and create an sbt project from it.

1. In the IDE, `File > Close Project` if there is an existing project open.
1. Select `Import Project` from the main menu, selecting this repo directory.
1. Then `Import project from external model`, selecting `sbt`.
1. Finally we need to select a JDK version if not already defaulted.
1. You can enable auto import if desired to download dependencies as needed.

After the initial sbt project load you should now be able to start development.

