import os
import sys
import subprocess
from infos import *

def getVersion() -> str:
        if not os.path.exists(VERSION_DIR):
                os.mkdir(VERSION_DIR)
                subprocess.run(["git", "clone", "--depth", "1", "--no-checkout", GITHUB_REPO, "."], cwd=VERSION_DIR, shell=True)
                subprocess.run(["git", "fetch", "--tags", "--depth", "1"], cwd=VERSION_DIR, shell=True)
        else:
                subprocess.run(["git", "pull", "--depth", "1"], cwd=VERSION_DIR, shell=True)

        version: str = subprocess.check_output(["git", "for-each-ref", "--sort=-creatordate", "--format", "%(refname:short)", "refs/tags"], cwd=VERSION_DIR, shell=True)
        version = version.decode("utf-8")
        version = version[:version.find('\n')]
        version = "1.0.0" if version == '' else version
        print(f"Current extension version is: {version}")

        return version

def fixPackages() -> None:
        # Update global variables for restorePackages()
        global PACKAGE, PACKAGE_LOCK

        # Replace --version in package.json
        with open("package.json", 'r', encoding="utf-8") as f:
                PACKAGE = f.read()
        with open("package.json", 'w', encoding="utf-8") as f:
                fixedPackage: str = PACKAGE.replace("--version", VERSION)
                f.write(fixedPackage)

        # Replace --version in package-lock.json
        if (os.path.exists("package-lock.json")):
                with open("package-lock.json", 'r', encoding="utf-8") as f:
                        PACKAGE_LOCK = f.read()
                with open("package-lock.json", 'w', encoding="utf-8") as f:
                        fixedPackageLock: str = PACKAGE_LOCK.replace("--version", VERSION)
                        f.write(fixedPackageLock)

def restorePackages() -> None:
        with open("package.json", 'w', encoding="utf-8") as f:
                f.write(PACKAGE)
        if (os.path.exists("package-lock.json")):
                with open("package-lock.json", 'w', encoding="utf-8") as f:
                        f.write(PACKAGE_LOCK)

if __name__ == "__main__":
        global VERSION;
        VERSION: str = getVersion()

        fixPackages()
        
        subprocess.run(["vsce", "package"], shell=True)

        restorePackages()

        for flag in sys.argv[1:]:
                match flag:
                        case "--install":
                                subprocess.run(["code", "--install-extension", f"{NAME}-{VERSION}.vsix"], shell=True)