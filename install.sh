#!/usr/bin/env bash
#
# FishTea installer.
#
#   curl -fsSL https://fishtea.io/install | bash              the newest release
#   curl -fsSL https://fishtea.io/install | bash -s 1.1.0     a particular one
#   ./install.sh --from .                                      build from this checkout
#
# Installs into ~/.fishtea/versions/<version>/ and points ~/.fishtea/current at it, so every version you
# have ever installed stays on disk and `fishtea use <version>` switches between them instantly. Nothing
# outside ~/.fishtea is written except one line in your shell profile, and only if you let it.
#
set -euo pipefail

FISHTEA_ROOT="${FISHTEA_ROOT:-$HOME/.fishtea}"
FISHTEA_RELEASES="${FISHTEA_RELEASES:-https://fishtea.io/releases}"
VERSION=""
FROM=""
NO_MODIFY_PATH=0

while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="${2:-}"; shift 2 ;;
    --no-modify-path) NO_MODIFY_PATH=1; shift ;;
    --root) FISHTEA_ROOT="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) VERSION="$1"; shift ;;
  esac
done

# The scratch directory is script-scoped, not function-local: the EXIT trap runs after the function that
# creates it has returned, and a `local` would be out of scope by then — which under `set -u` made the
# cleanup itself fail and leak the directory.
WORK=""
cleanup() { [ -n "${WORK:-}" ] && rm -rf "$WORK"; }
trap cleanup EXIT

say()  { printf '%s\n' "$*"; }
bold() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed"; }

detect_target() {
  local os arch
  case "$(uname -s)" in
    Linux)  os=linux ;;
    Darwin) os=darwin ;;
    MINGW*|MSYS*|CYGWIN*) os=windows ;;
    *) die "unsupported operating system: $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) die "unsupported architecture: $(uname -m)" ;;
  esac
  printf '%s-%s' "$os" "$arch"
}

# --- build from a checkout -----------------------------------------------------------------------
# The path that needs nothing published. `bun run build-release --install` does the same work the
# download path does, so both end at exactly the same layout.
install_from_checkout() {
  local checkout="$1"
  [ -f "$checkout/scripts/build-release.ts" ] || die "$checkout is not a fishtea checkout"
  need bun
  bold "Building fishtea from $checkout"
  ( cd "$checkout" && FISHTEA_ROOT="$FISHTEA_ROOT" bun run build-release --install )
}

# --- download a published release ----------------------------------------------------------------
install_from_release() {
  need curl
  need tar
  local target; target="$(detect_target)"

  if [ -z "$VERSION" ]; then
    VERSION="$(curl -fsSL "$FISHTEA_RELEASES/latest" 2>/dev/null || true)"
    [ -n "$VERSION" ] || die "could not read $FISHTEA_RELEASES/latest.
  Nothing is published there yet. Build from a checkout instead:
      git clone <the repo> fishtea && ./fishtea/install.sh --from ./fishtea"
  fi

  local name="fishtea-$VERSION-$target"
  local url="$FISHTEA_RELEASES/$name.tar.gz"
  WORK="$(mktemp -d)"

  bold "Downloading fishtea $VERSION ($target)"
  curl -fsSL "$url" -o "$WORK/release.tar.gz" || die "no release at $url"

  # Verify against the published checksums. This is a curl|bash installer downloading a 30 MB binary;
  # checking what arrived is the least it can do, so it fails closed: no SHA256SUMS, no line for this
  # tarball, or no tool to hash it with, and nothing is installed. A self-hosted FISHTEA_RELEASES that
  # publishes no checksums can say so with FISHTEA_INSECURE_DOWNLOAD=1, and is warned rather than refused.
  unverified() {
    if [ "${FISHTEA_INSECURE_DOWNLOAD:-}" = "1" ]; then warn "$1 — installing unverified (FISHTEA_INSECURE_DOWNLOAD=1)"; return 0; fi
    die "$1
  Refusing to install what cannot be checked. FISHTEA_INSECURE_DOWNLOAD=1 overrides this for a self-hosted mirror."
  }
  if curl -fsSL "$FISHTEA_RELEASES/SHA256SUMS" -o "$WORK/SHA256SUMS" 2>/dev/null; then
    local want got=""
    want="$(awk -v n="$name.tar.gz" '$2 == n || $2 == "*"n {print $1}' "$WORK/SHA256SUMS" | head -1)"
    if [ -n "$want" ]; then
      if command -v sha256sum >/dev/null 2>&1; then got="$(sha256sum "$WORK/release.tar.gz" | cut -d" " -f1)"
      elif command -v shasum   >/dev/null 2>&1; then got="$(shasum -a 256 "$WORK/release.tar.gz" | cut -d" " -f1)"
      fi
      if [ -z "$got" ]; then
        unverified "neither sha256sum nor shasum is installed, so $name.tar.gz cannot be checked"
      elif [ "$got" != "$want" ]; then
        die "checksum mismatch for $name.tar.gz
  expected $want
  got      $got
  Refusing to install. Try again; if it persists, something is wrong at $FISHTEA_RELEASES."
      else
        say "  checksum ok"
      fi
    else
      unverified "no checksum listed for $name.tar.gz in $FISHTEA_RELEASES/SHA256SUMS"
    fi
  else
    unverified "no SHA256SUMS at $FISHTEA_RELEASES — cannot verify the download"
  fi

  tar -xzf "$WORK/release.tar.gz" -C "$WORK"

  local staged; staged="$(find "$WORK" -maxdepth 1 -type d -name 'fishtea-*' | head -1)"
  [ -n "$staged" ] || die "the archive did not contain a fishtea release"

  mkdir -p "$FISHTEA_ROOT/versions"
  rm -rf "$FISHTEA_ROOT/versions/$VERSION"
  mv "$staged" "$FISHTEA_ROOT/versions/$VERSION"

  ln -sfn "$FISHTEA_ROOT/versions/$VERSION" "$FISHTEA_ROOT/current"
  mkdir -p "$FISHTEA_ROOT/bin"
  ln -sfn "../current/bin/fishtea" "$FISHTEA_ROOT/bin/fishtea"
}

# --- shell profile -------------------------------------------------------------------------------
profile_file() {
  case "$(basename "${SHELL:-/bin/bash}")" in
    zsh)  printf '%s' "${ZDOTDIR:-$HOME}/.zshrc" ;;
    fish) printf '%s' "$HOME/.config/fish/config.fish" ;;
    *)    if [ -f "$HOME/.bashrc" ]; then printf '%s' "$HOME/.bashrc"; else printf '%s' "$HOME/.profile"; fi ;;
  esac
}

add_to_path() {
  local bin="$FISHTEA_ROOT/bin" rc; rc="$(profile_file)"
  case ":$PATH:" in *":$bin:"*) return 0 ;; esac
  [ "$NO_MODIFY_PATH" -eq 0 ] || { warn "add this to your shell profile:  export PATH=\"$bin:\$PATH\""; return 0; }

  local line
  if [ "$(basename "$rc")" = "config.fish" ]; then line="fish_add_path $bin"; else line="export PATH=\"$bin:\$PATH\""; fi
  if [ -f "$rc" ] && grep -qF "$bin" "$rc"; then return 0; fi
  mkdir -p "$(dirname "$rc")"
  printf '\n# fishtea\n%s\n' "$line" >> "$rc"
  say "  added $bin to PATH in $rc"
}

# --- run -----------------------------------------------------------------------------------------
if [ -n "$FROM" ]; then install_from_checkout "$FROM"; else install_from_release; fi

VERSION="$(cat "$FISHTEA_ROOT/current/VERSION" 2>/dev/null || printf '%s' "$VERSION")"
add_to_path

say ""
bold "fishtea $VERSION"
say "  $FISHTEA_ROOT/versions/$VERSION"
say ""
say "  fishtea templates                       the archetypes you can start from"
say "  fishtea new myshop --template ecommerce --interactive"
say "  fishtea versions                        every version you have; switch with: fishtea use <v>"
say ""
case ":$PATH:" in
  *":$FISHTEA_ROOT/bin:"*) ;;
  *) say "  Open a new shell, or: export PATH=\"$FISHTEA_ROOT/bin:\$PATH\"" ;;
esac

# Postgres and the classifier pool are services, not files, so they are never bundled into the binary.
command -v docker >/dev/null 2>&1 || warn "Docker was not found. \`fishtea up\` needs it for Postgres and the classifier pool."
