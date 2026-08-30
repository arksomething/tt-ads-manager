#!/usr/bin/env bash
set -euo pipefail

# TikTok changes its public-web request fingerprinting independently of the
# distro release cycle. Install the exact reviewed upstream runtime that the
# collector validates in-process; never fall back to /usr/bin/yt-dlp.
readonly ytdlp_version='2026.08.19'
readonly ytdlp_sha256='58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a'
readonly ytdlp_sha512='e51e26f77622a1bf75cdaee869698aebe892d4afd105e677118eb8dfbacef9d34933e7b3c0f1091f3f7f94518ac03bb2504e69be85991c31d61e5e8faeb85f37'
readonly signing_key_fingerprint='AC0CBBE6848D6A873464AF4E57CF65933B5A7581'
readonly ytdlp_url="https://github.com/yt-dlp/yt-dlp/releases/download/${ytdlp_version}/yt-dlp_linux"
readonly signing_key_url="https://raw.githubusercontent.com/yt-dlp/yt-dlp/${ytdlp_version}/public.key"
readonly release_asset_base="https://github.com/yt-dlp/yt-dlp/releases/download/${ytdlp_version}"
readonly install_dir="/opt/creator-tracker/yt-dlp/${ytdlp_version}"
readonly install_path="$install_dir/yt-dlp_linux"

case "$install_dir:$install_path" in
  /*:/*) ;;
  *) printf '%s\n' 'creator-tracker: yt-dlp paths must be absolute' >&2; exit 78 ;;
esac

has_chrome_target() {
  local targets
  targets="$("$1" --list-impersonate-targets)"
  grep -Eiq '^Chrome-' <<<"$targets"
}

download_https() {
  local url="$1"
  local destination="$2"
  curl \
    --proto '=https' \
    --tlsv1.2 \
    --fail \
    --location \
    --silent \
    --show-error \
    --output "$destination" \
    "$url"
}

umask 077
sudo -n install -d -o root -g root -m 0755 "$install_dir"
if [[ -L "$install_dir" || ! -d "$install_dir" ]]; then
  printf 'creator-tracker: unsafe runtime directory: %s\n' "$install_dir" >&2
  exit 78
fi

if [[ -e "$install_path" ]]; then
  if [[ -f "$install_path" && ! -L "$install_path" ]] && \
     [[ "$(stat -c '%u:%g:%a:%h' "$install_path")" == '0:0:555:1' ]] && \
     [[ "$(sha256sum "$install_path" | cut -d' ' -f1)" == "$ytdlp_sha256" ]] && \
     [[ "$(sha512sum "$install_path" | cut -d' ' -f1)" == "$ytdlp_sha512" ]] && \
     [[ "$($install_path --version)" == "$ytdlp_version" ]] && \
     has_chrome_target "$install_path"; then
    printf 'creator-tracker: reviewed yt-dlp %s already installed at %s\n' \
      "$ytdlp_version" "$install_path"
    exit 0
  fi
fi

tmp_base="${TMPDIR:-/tmp}"
[[ "$tmp_base" == /* ]] || {
  printf '%s\n' 'creator-tracker: TMPDIR must be absolute' >&2
  exit 78
}
tmp_dir="$(mktemp -d "$tmp_base/creator-tracker-ytdlp.XXXXXX")"
cleanup() {
  rm -rf -- "$tmp_dir"
}
trap cleanup EXIT

download_path="$tmp_dir/yt-dlp_linux"
download_https "$ytdlp_url" "$download_path"
download_https "$signing_key_url" "$tmp_dir/public.key"
for sums_asset in \
  SHA2-256SUMS \
  SHA2-256SUMS.sig \
  SHA2-512SUMS \
  SHA2-512SUMS.sig; do
  download_https "$release_asset_base/$sums_asset" "$tmp_dir/$sums_asset"
done

gnupg_home="$tmp_dir/gnupg"
install -d -m 0700 "$gnupg_home"
imported_fingerprints="$(
  GNUPGHOME="$gnupg_home" gpg \
    --batch \
    --with-colons \
    --import-options show-only \
    --import "$tmp_dir/public.key" 2>/dev/null |
    awk -F: '$1 == "fpr" { print $10 }'
)"
if [[ "$imported_fingerprints" != "$signing_key_fingerprint" ]]; then
  printf 'creator-tracker: unexpected yt-dlp signing key fingerprint: %s\n' \
    "$imported_fingerprints" >&2
  exit 1
fi
GNUPGHOME="$gnupg_home" gpg --batch --quiet --import "$tmp_dir/public.key"
GNUPGHOME="$gnupg_home" gpg --batch --quiet \
  --verify "$tmp_dir/SHA2-256SUMS.sig" "$tmp_dir/SHA2-256SUMS"
GNUPGHOME="$gnupg_home" gpg --batch --quiet \
  --verify "$tmp_dir/SHA2-512SUMS.sig" "$tmp_dir/SHA2-512SUMS"

manifest_sha256="$(
  awk '$2 == "yt-dlp_linux" { print $1 }' "$tmp_dir/SHA2-256SUMS"
)"
manifest_sha512="$(
  awk '$2 == "yt-dlp_linux" { print $1 }' "$tmp_dir/SHA2-512SUMS"
)"
if [[ "$manifest_sha256" != "$ytdlp_sha256" || \
      "$manifest_sha512" != "$ytdlp_sha512" ]]; then
  printf '%s\n' \
    'creator-tracker: signed yt-dlp manifests disagree with the reviewed hashes' >&2
  exit 1
fi

actual_sha256="$(sha256sum "$download_path" | cut -d' ' -f1)"
if [[ "$actual_sha256" != "$ytdlp_sha256" ]]; then
  printf 'creator-tracker: yt-dlp checksum mismatch: expected %s, got %s\n' \
    "$ytdlp_sha256" "$actual_sha256" >&2
  exit 1
fi
actual_sha512="$(sha512sum "$download_path" | cut -d' ' -f1)"
if [[ "$actual_sha512" != "$ytdlp_sha512" ]]; then
  printf 'creator-tracker: yt-dlp SHA-512 mismatch: expected %s, got %s\n' \
    "$ytdlp_sha512" "$actual_sha512" >&2
  exit 1
fi

chmod 0700 "$download_path"
actual_version="$($download_path --version)"
if [[ "$actual_version" != "$ytdlp_version" ]]; then
  printf 'creator-tracker: yt-dlp version mismatch: expected %s, got %s\n' \
    "$ytdlp_version" "$actual_version" >&2
  exit 1
fi
if ! has_chrome_target "$download_path"; then
  printf '%s\n' \
    'creator-tracker: yt-dlp runtime has no Chrome impersonation target' >&2
  exit 1
fi

staged_path="$install_dir/.yt-dlp_linux.new.$$"
sudo -n install -o root -g root -m 0555 "$download_path" "$staged_path"
sudo -n mv -f -- "$staged_path" "$install_path"

installed_sha256="$(sha256sum "$install_path" | cut -d' ' -f1)"
[[ "$installed_sha256" == "$ytdlp_sha256" ]]
[[ "$(sha512sum "$install_path" | cut -d' ' -f1)" == "$ytdlp_sha512" ]]
[[ "$($install_path --version)" == "$ytdlp_version" ]]
[[ "$(stat -c '%u:%g:%a:%h' "$install_path")" == '0:0:555:1' ]]
has_chrome_target "$install_path"

printf 'creator-tracker: installed reviewed yt-dlp %s at %s\n' \
  "$ytdlp_version" "$install_path"
