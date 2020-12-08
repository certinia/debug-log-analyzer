# Getting Started as a Contributor

The extension source code is written in [Scala](https://www.scala-lang.org/). This is cross-compiled into Javascript as part of the build process using [Scala.js](https://www.scala-js.org/). To re-build from source install the prerequisites and then follow the building instructions. 

## Prerequisites for OS X Development

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

## Prerequisites for other platforms

To install Java we recommend downloading from [AdoptOpenJDK](https://adoptopenjdk.net/).
For SBT instructions for other platforms can be found at [SBT](https://www.scala-sbt.org/index.html).


# Development

## Building

This project uses [SBT](https://www.scala-sbt.org/) to build each sub-project
and generate the VS Code extension.

Example SBT commands:

- `sbt build` (=== to `sbt lana/build`) - Build the VS Code extension with debugging support
- `sbt clean && sbt build` - Clear artifacts and do full rebuild
- `sbt prod:build` - Use production mode and configuration for full build

## Intellij

The Scala [Intellij](https://www.jetbrains.com/idea/) plugin has a number of useful features and integrations that make it
highly recommended for Scala development. Ensure you have installed and enabled it first. This can be done with the free Community Edition of Intellij.

The Intellij project files are ignored in this repository, so for a clean repo we need
to import and create an sbt project from it.

1. In the IDE, `File > Close Project` if there is an existing project open.
1. Select `Import Project` from the main menu, selecting this repo directory.
1. Then `Import project from external model`, selecting `sbt`.
1. Finally we need to select a JDK version if not already defaulted.
1. You can enable auto import if desired to download dependencies as needed.

After the initial sbt project load you should now be able to start development.

