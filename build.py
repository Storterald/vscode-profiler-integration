import os
import sys
import json
import subprocess
from argparse import ArgumentParser


def fix_version() -> tuple[str, str]:
        with open("package.json", 'r+', encoding="utf-8") as f:
                data = json.load(f)
                f.seek(0)

                if "version" not in data:
                        data["version"] = "1.0.0"
                        json.dump(data, f, indent=2)
                        f.truncate()
        
        with open("package-lock.json", 'r+', encoding="utf-8") as f:
                lock = json.load(f)
                f.seek(0)
                lock["version"]                 = data["version"]
                lock["packages"][""]["version"] = data["version"]
                json.dump(lock, f, indent=2)
                f.truncate()

        return data["version"], data["name"]


if __name__ == "__main__":
        if not os.path.exists("package.json"):
                raise Exception("package.json is missing")
        
        if not os.path.exists("package-lock.json"):
                subprocess.run("npm i", shell=True)

        version, name = fix_version()
        subprocess.run("vsce package", shell=True)

        parser = ArgumentParser(
                prog="Extension Builder",
                description="Builds the .vsix extension")
        parser.add_argument("-I", "--install", action="store_true")
        args = parser.parse_args()
        
        if args.install:
                subprocess.run(f"code --install-extension {name}-{version}.vsix", shell=True)
