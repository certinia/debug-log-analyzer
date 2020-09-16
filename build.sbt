import scala.sys.process._

// Build-wide settings
ThisBuild / organization := "com.financialforce"
ThisBuild / version := "1.3.0"
ThisBuild / scalaVersion := "2.12.6"
ThisBuild / resolvers ++= Seq(
  Resolver.sonatypeRepo("releases"),
  Resolver.sonatypeRepo("snapshots"),
  Resolver.mavenLocal
)
ThisBuild / testOptions += Tests.Argument(TestFrameworks.ScalaTest, "-oDI")
ThisBuild / Test / aggregate := false
ThisBuild / IntegrationTest / aggregate := false

// Setting Keys
lazy val buildOutput = settingKey[String]("Name of build output file")
lazy val distDir = settingKey[File]("Distribution directory for project")
lazy val jsFullOpt = settingKey[Boolean]("Enable full optimisation of JS")
lazy val configFile = settingKey[String]("Optional config file name to use")

// Task Keys
lazy val build = taskKey[File]("Build final packaged artifact")
lazy val buildJs = taskKey[Attributed[File]]("Build a scala js bundle")
lazy val testAll = taskKey[Unit]("Execute tests for all projects")

// Configurations
lazy val Prod = config("prod") extend Compile

// Test Dependencies
// Shared between JS/JVM
val scalaTest = Def.settingDyn {
  val pc = thisProject.value.configurations
  val configs = if (pc.contains(IntegrationTest)) "test,it" else "test"
  Def.setting {
    // %%% must be used within a task or setting
    Seq(
      "org.scalamock" %%% "scalamock" % "4.4.0",
      "org.scalatest" %%% "scalatest" % "3.1.1"
    ).map(_ % configs)
  }
}

// Plugins
val macroParadise = "org.scalamacros" % "paradise" % "2.1.1" cross CrossVersion.full

val buildOptions = Seq(
  "-language:postfixOps",
  "-deprecation",
  "-feature"
)

val commonJsSettings = Seq(
  libraryDependencies ++= Seq(
    "io.scalajs" %%% "core" % "0.4.2",
    "net.exoego" %%% "scala-js-nodejs-v12" % "0.10.0",
    "com.lihaoyi" %%% "upickle" % "0.9.0"
) ++ scalaTest.value,
  scalacOptions ++= buildOptions ++ Seq(
    "-P:scalajs:sjsDefinedByDefault"
  ),
  scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.CommonJSModule) },
  scalaJSLinkerConfig ~= { _.withESFeatures(_.withUseECMAScript2015(true)) },
  jsFullOpt := false,
  Prod / jsFullOpt := true,
  buildJs / aggregate := false,
  buildJs := buildJsImpl.value
) ++ inConfig(Prod)(Seq(
  buildJs := buildJsImpl.value
))

lazy val lana = project
  .enablePlugins(ScalaJSPlugin, BuildInfoPlugin)
  .configs(Prod)
  .settings(
    name := "lana",
    commonJsSettings,
    Test / jsDependencies += {
      ProvidedJS / "vscode.js" commonJSName "vscode"
    },
    distDir := baseDirectory.value / "dist",
    configFile := "dev",
    Prod / configFile := "production",
    buildOutput := "lana-*.vsix",
    build := buildLana.value,
    inConfig(Prod)(Seq(
      build := buildLana.value
    )),
    libraryDependencies += "com.github.nawforce" %%% "pkgforce" % "1.0.0",
    npmPackageDirs ++= Seq(
      baseDirectory.value / "js/log-viewer"
    ),
    cleanFiles ++= Seq(
      distDir.value / "bundle.js",
      distDir.value / "config.json",
      distDir.value / "spa/"
    ),
    buildInfoKeys := Seq[BuildInfoKey](name, version, scalaVersion, sbtVersion),
    buildInfoPackage := "com.financialforce.lana",
    buildInfoOptions += BuildInfoOption.BuildTime
  )

// Root project
// Aggregates sub-project tasks
lazy val root = (project in file("."))
  .aggregate(lana)
  .configs(Prod)
  .settings(
    name := "lana",
    publish / skip := true,
    assembly / aggregate := false,
    build / aggregate := false,
    build := (LocalProject("lana") / build).value,
    testAll := testAllImpl.value,
    inConfig(Prod)(Seq(
      build := (LocalProject("lana") / build).value
    )),
    cleanFiles ++= (baseDirectory.value * ("*.vsix" || "*.tgz")).get
  )

// Task Implementations
lazy val buildLana = Def.sequential(
  npmInstall,
  buildVsixImpl(false)
)

def buildVsixImpl(includeSFDX: Boolean) = Def.task {

  def exec: ProcessBuilder => Unit = run(streams.value.log)(_)

  val dist = distDir.value
  val rootDir = baseDirectory.value.getParentFile
  var outFiles: Map[File, File] = Map()

  // MAIN

  outFiles += (
    buildJs.value.data -> dist / "bundle.js",
    dist / s"config/${configFile.value}.json" -> dist / "config.json"
  )

  // SPAS

  npmPackageDirs.value foreach {
    pkg =>
      val target = dist / "spa" / pkg.getName
      exec(Process("npm run build", pkg))
      outFiles += (
        pkg / "dist/bundle.js" -> target / "bundle.js",
        pkg / "index.html" -> target / "index.html"
      )
  }


  // OUTPUT

  IO.copy(
    outFiles,
    CopyOptions().withOverwrite(true)
  )

  exec(Process(s"vsce package --out ${rootDir.toString}", dist))
  (rootDir * buildOutput.value).get.last

}

// Dynamically get JS optimisation task
lazy val buildJsImpl: Def.Initialize[Task[Attributed[File]]] = Def.taskDyn {
  if (jsFullOpt.value)
    Compile / fullOptJS
  else
    Compile / fastOptJS
}

// Add test and integration test tasks to list as needed
lazy val testAllImpl = Def.sequential(
  lana / Test / test
)

// Run a process and log to provided logger
def run(log: ProcessLogger)(proc: ProcessBuilder): Unit = {
  val exitCode = proc ! log
  if (exitCode > 0) {
    log.err(s"Process exited with non-zero exit code: $exitCode")
    sys.exit()
  }
}
