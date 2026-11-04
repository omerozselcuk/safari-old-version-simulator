#!/bin/bash
set -euo pipefail

launcher_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
launcher_check=false
launcher_app=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --check) launcher_check=true; shift ;;
    --app)
      if [ "$#" -lt 2 ]; then
        echo 'Error: --app requires the path to Safari Old Version Simulator.app.' >&2
        exit 2
      fi
      launcher_app="$2"; shift 2 ;;
    --help|-h)
      echo 'Usage: ./start.sh [--check] [--app "/path/Safari Old Version Simulator.app"]'
      exit 0 ;;
    *) echo "Error: unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ "$(uname -s)" != 'Darwin' ]; then
  echo 'Error: this launcher requires macOS 13 or later.' >&2
  exit 1
fi
if [ "$(uname -m)" != 'arm64' ]; then
  echo 'Error: this package requires an Apple Silicon Mac and a native Terminal session.' >&2
  exit 1
fi
launcher_macos="$(sw_vers -productVersion)"
launcher_major="${launcher_macos%%.*}"
if ! [[ "$launcher_major" =~ ^[0-9]+$ ]] || [ "$launcher_major" -lt 13 ]; then
  echo "Error: macOS 13 or later is required; this Mac runs $launcher_macos." >&2
  exit 1
fi

if [ -z "$launcher_app" ] && [ -d "$launcher_root/Safari Old Version Simulator.app" ]; then
  launcher_app="$launcher_root/Safari Old Version Simulator.app"
fi
if [ -n "$launcher_app" ]; then
  launcher_executable="$launcher_app/Contents/MacOS/Safari Old Version Simulator"
  if [ ! -x "$launcher_executable" ]; then
    echo "Error: the application executable was not found at $launcher_executable." >&2
    exit 1
  fi
  echo "macOS $launcher_macos · Apple Silicon · Application bundle"
  if [ "$launcher_check" = true ]; then
    echo "Ready: $launcher_app"
    exit 0
  fi
  echo 'Launching Safari Old Version Simulator. Press Ctrl+C to quit.'
  unset ELECTRON_RUN_AS_NODE
  exec "$launcher_executable"
fi

launcher_node="$launcher_root/node_modules/node/bin/node"
launcher_runtime="$launcher_root/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [ ! -x "$launcher_node" ] || [ ! -x "$launcher_runtime" ]; then
  echo 'Error: source dependencies are missing. Run npm install in the project folder first.' >&2
  exit 1
fi
echo "macOS $launcher_macos · Apple Silicon · Source application"
if [ "$launcher_check" = true ]; then
  echo "Ready: $launcher_root"
  exit 0
fi
echo 'Launching Safari Old Version Simulator. Press Ctrl+C to quit.'
unset ELECTRON_RUN_AS_NODE
cd "$launcher_root"
exec "$launcher_runtime" "$launcher_root"
