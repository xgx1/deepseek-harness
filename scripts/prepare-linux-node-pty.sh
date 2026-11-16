#!/usr/bin/env bash
set -euo pipefail

# Generate node-gyp's Makefile on the runner, then compile against glibc 2.28.
case "$(uname -m)" in
  x86_64) image=quay.io/pypa/manylinux_2_28_x86_64 ;;
  aarch64) image=quay.io/pypa/manylinux_2_28_aarch64 ;;
  *) echo 'node-pty release preparation requires native Linux x64 or arm64' >&2; exit 1 ;;
esac
addon_dir="$(realpath packages/subprocess/subprocess-local/node_modules/node-pty)"
nub_home_dir="$(realpath "$HOME/.nub")"
(cd "$addon_dir" && npm_config_build_from_source=true nub run install)
addon="$addon_dir/build/Release/pty.node"
test -f "$addon_dir/build/Makefile"
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$PWD:$PWD" \
  -v "$HOME/.cache/node-gyp:$HOME/.cache/node-gyp:ro" \
  -v "$nub_home_dir:$nub_home_dir:ro" \
  -w "$addon_dir" "$image" \
  bash -euxo pipefail -c 'rm -rf build/Release && make -C build -j2 BUILDTYPE=Release'
test -f "$addon"
readelf --version-info "$addon"
