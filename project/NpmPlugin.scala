import java.nio.file.{Files, Path}

import org.scalajs.sbtplugin.ScalaJSPlugin
import sbt.Keys._
import sbt.nio.Keys._
import sbt.{Def, _}

import scala.sys.process.Process

object NpmPlugin extends AutoPlugin {
  override def requires: Plugins = ScalaJSPlugin
  override def trigger = allRequirements

  object autoImport {
    lazy val npmPackageDirs = settingKey[Seq[File]]("Directories to execute npm commands for")
    lazy val npmInstall = taskKey[Unit]("Run npm install for packages if required")
  }
  import autoImport._

  override lazy val projectSettings = Seq(
    npmPackageDirs := Seq(),
    npmInstall / fileInputs := npmPackageInputs.value,
    npmInstall := npmInstallImpl.value
  )

  // package{-lock}.json files for each package
  lazy val npmPackageInputs = Def.setting {
    npmPackageDirs.value collect {
      case f if f.isDirectory => f.toGlob / "package(?:-lock)?\\.json".r
    }
  }

  lazy val npmInstallImpl = Def.task {
    val log = streams.value.log
    val input = npmInstall.inputFiles
    val changes = npmInstall.inputFileChanges

    // If either the node_modules folder does not exist
    // or a package{-lock}.json has updated execute the install
    val emptyPackages: Set[Path] = input.foldLeft(Set[Path]()) {
       _ + _.getParent
    } filter {
      p => Files.notExists(p / "node_modules")
    }

    val changedPackages = (changes.created ++ changes.modified).map {
      _.getParent
    }
    val packagesToInstall = emptyPackages ++ changedPackages

    if (packagesToInstall.nonEmpty) {
      log.info(s"Installing npm packages for ${name.value}")
    } else {
      log.info(s"Npm packages for ${name.value} up to date")
    }

    packagesToInstall foreach {
      pkg =>
        val result = Process("npm install", pkg.toFile) !! log
        log.debug(result)
        log.info(s"Installed npm package: ${pkg.toString}")
    }

  }

}
