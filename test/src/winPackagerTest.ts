import { Platform, Arch, BuildInfo } from "out"
import { assertPack, platform, modifyPackageJson, getTestAsset, app, appThrows } from "./helpers/packTester"
import { outputFile, rename, copy } from "fs-extra-p"
import * as path from "path"
import { WinPackager } from "out/winPackager"
import BluebirdPromise from "bluebird-lst-c"
import { SignOptions } from "out/windowsCodeSign"
import SquirrelWindowsTarget from "out/targets/squirrelWindows"
import { Target } from "out/platformPackager"

test.ifNotCiMac("win", app({targets: Platform.WINDOWS.createTarget(["squirrel", "zip"])}, {signed: true}))

// very slow
test.skip("delta and msi", app({
  targets: Platform.WINDOWS.createTarget("squirrel", Arch.ia32),
  devMetadata: {
    build: {
      squirrelWindows: {
        remoteReleases: "https://github.com/develar/__test-app-releases",
        msi: true,
      },
    }
  },
}))

test.ifDevOrWinCi("beta version", app({
  targets: Platform.WINDOWS.createTarget(["squirrel", "nsis"]),
  devMetadata: <any>{
    version: "3.0.0-beta.2",
  }
}))

test.ifNotCiMac("msi as string", () => appThrows(/msi expected to be boolean value, but string '"false"' was specified/, {targets: Platform.WINDOWS.createTarget("squirrel")}, {
  projectDirCreated: it => modifyPackageJson(it, data => {
    data.build.win = {
      msi: "false",
    }
  })
}))

test("detect install-spinner, certificateFile/password", () => {
  let platformPackager: CheckingWinPackager = null
  let loadingGifPath: string = null

  return assertPack("test-app-one", {
    targets: Platform.WINDOWS.createTarget("squirrel"),
    platformPackagerFactory: (packager, platform, cleanupTasks) => platformPackager = new CheckingWinPackager(packager),
    devMetadata: {
      build: {
        win: {
          certificatePassword: "pass",
        }
      }
    }
  }, {
    projectDirCreated: it => {
      loadingGifPath = path.join(it, "build", "install-spinner.gif")
      return BluebirdPromise.all([
        copy(getTestAsset("install-spinner.gif"), loadingGifPath),
        modifyPackageJson(it, data => {
          data.build.win = {
            certificateFile: "secretFile",
            certificatePassword: "mustBeOverridden",
          }
        })])
    },
    packed: async () => {
      expect(platformPackager.effectiveDistOptions.loadingGif).toEqual(loadingGifPath)
      expect(platformPackager.signOptions.cert).toEqual("secretFile")
      expect(platformPackager.signOptions.password).toEqual("pass")
    },
  })
})

test.ifNotCiMac("icon < 256", t => appThrows(/Windows icon size must be at least 256x256, please fix ".+/, platform(Platform.WINDOWS), {
  projectDirCreated: projectDir => rename(path.join(projectDir, "build", "incorrect.ico"), path.join(projectDir, "build", "icon.ico"))
}))

test.ifNotCiMac("icon not an image", appThrows(/Windows icon is not valid ico file, please fix ".+/, platform(Platform.WINDOWS), {
  projectDirCreated: projectDir => outputFile(path.join(projectDir, "build", "icon.ico"), "foo")
}))

test.ifMac("custom icon", () => {
  let platformPackager: CheckingWinPackager = null
  return assertPack("test-app-one", {
    targets: Platform.WINDOWS.createTarget("squirrel"),
    platformPackagerFactory: (packager, platform, cleanupTasks) => platformPackager = new CheckingWinPackager(packager)
  }, {
    projectDirCreated: projectDir => BluebirdPromise.all([
      rename(path.join(projectDir, "build", "icon.ico"), path.join(projectDir, "customIcon.ico")),
      modifyPackageJson(projectDir, data => {
        data.build.win = {
          icon: "customIcon"
        }
      })
    ]),
    packed: async context => {
      expect(await platformPackager.getIconPath()).toEqual(path.join(context.projectDir, "customIcon.ico"))
    },
  })
})

it.ifNotWindows("ev", () => appThrows(/certificateSubjectName supported only on Windows/, {
  targets: Platform.WINDOWS.createTarget(["dir"]),
  devMetadata: {
    build: {
      win: {
        certificateSubjectName: "ev",
      }
    }
  }
}))

class CheckingWinPackager extends WinPackager {
  effectiveDistOptions: any
  signOptions: SignOptions | null

  constructor(info: BuildInfo) {
    super(info)
  }

  async pack(outDir: string, arch: Arch, targets: Array<Target>, postAsyncTasks: Array<Promise<any>>): Promise<any> {
    // skip pack
    const helperClass: typeof SquirrelWindowsTarget = require("out/targets/squirrelWindows").default
    this.effectiveDistOptions = await (new helperClass(this).computeEffectiveDistOptions())

    await this.sign(this.computeAppOutDir(outDir, arch))
  }

  packageInDistributableFormat(outDir: string, appOutDir: string, arch: Arch, targets: Array<Target>, promises: Array<Promise<any>>): void {
    // skip
  }

  protected doSign(opts: SignOptions): Promise<any> {
    this.signOptions = opts
    return BluebirdPromise.resolve(null)
  }
}