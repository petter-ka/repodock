#!/bin/sh
# RepoDock installer for macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/petter-ka/repodock/main/install.sh | sh
#
# Downloads a release from GitHub, verifies it against the release's
# SHA256SUMS.txt, and installs RepoDock.app into /Applications (or
# ~/Applications when /Applications is not writable).
#
# Builds are not signed with an Apple Developer ID yet. Files downloaded with
# curl are not quarantined, so the app opens without a Gatekeeper prompt;
# you are trusting this repository's releases and the checksum instead of
# Apple notarization. Read this script before running it if you prefer.
#
# Options (environment variables):
#   REPODOCK_VERSION      release tag to install, e.g. v0.2.0 (default: latest)
#   REPODOCK_INSTALL_DIR  target folder (default: /Applications, else ~/Applications)

set -eu

REPO="petter-ka/repodock"
APP="RepoDock.app"

say() { printf '%s\n' "$*"; }
fail() { printf 'RepoDock installer: %s\n' "$*" >&2; exit 1; }

# Everything runs inside main, called on the last line, so a truncated
# download (curl | sh) cannot execute a partial script.
main() {
  [ "$(uname -s)" = "Darwin" ] || fail "this installer is for macOS. Windows builds: https://github.com/$REPO/releases/latest"
  for tool in curl shasum ditto; do
    command -v "$tool" >/dev/null 2>&1 || fail "required tool not found: $tool"
  done

  tag="${REPODOCK_VERSION:-}"
  if [ -z "$tag" ]; then
    # /releases/latest redirects to /releases/tag/<tag>; avoids API rate limits.
    latest_url="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")" \
      || fail "could not reach GitHub"
    tag="${latest_url##*/}"
    case "$tag" in
      ""|latest|releases) fail "no published release found at https://github.com/$REPO/releases" ;;
    esac
  fi

  asset="RepoDock-${tag}-macos-universal.zip"
  base="https://github.com/$REPO/releases/download/$tag"

  tmp="$(mktemp -d "${TMPDIR:-/tmp}/repodock-install.XXXXXX")"
  trap 'rm -rf "$tmp"' EXIT INT TERM

  say "Downloading RepoDock $tag…"
  curl -fL --progress-bar -o "$tmp/$asset" "$base/$asset" || fail "download failed: $base/$asset"
  curl -fsSL -o "$tmp/SHA256SUMS.txt" "$base/SHA256SUMS.txt" || fail "could not download SHA256SUMS.txt for $tag"

  expected="$(awk -v f="$asset" '{ name = $2; sub(/^\*/, "", name); if (name == f) { print $1; exit } }' "$tmp/SHA256SUMS.txt")"
  [ -n "$expected" ] || fail "$asset is not listed in SHA256SUMS.txt"
  actual="$(shasum -a 256 "$tmp/$asset" | awk '{ print $1 }')"
  [ "$expected" = "$actual" ] || fail "checksum mismatch for $asset (expected $expected, got $actual)"
  say "Checksum verified."

  ditto -x -k "$tmp/$asset" "$tmp/unpacked" || fail "could not unpack $asset"
  [ -d "$tmp/unpacked/$APP" ] || fail "$APP not found in $asset"

  dir="${REPODOCK_INSTALL_DIR:-}"
  if [ -z "$dir" ]; then
    if [ -w /Applications ]; then dir="/Applications"; else dir="$HOME/Applications"; fi
  fi
  mkdir -p "$dir" || fail "cannot create $dir"
  [ -w "$dir" ] || fail "$dir is not writable; set REPODOCK_INSTALL_DIR to another folder"
  dest="$dir/$APP"

  if pgrep -f "$dest/Contents/MacOS/" >/dev/null 2>&1; then
    fail "RepoDock is running. Quit it and run the installer again."
  fi

  # Swap in the new bundle; restore the old one if the move fails.
  if [ -e "$dest" ]; then
    mv "$dest" "$tmp/previous.app" || fail "cannot replace $dest"
  fi
  if ! mv "$tmp/unpacked/$APP" "$dest"; then
    [ -e "$tmp/previous.app" ] && mv "$tmp/previous.app" "$dest"
    fail "cannot install to $dest"
  fi
  # curl does not quarantine downloads; clear the flag in case another tool added it.
  xattr -dr com.apple.quarantine "$dest" 2>/dev/null || true

  say "Installed RepoDock $tag to $dest"
  say "Open it from $dir, or run: open \"$dest\""
}

main "$@"
