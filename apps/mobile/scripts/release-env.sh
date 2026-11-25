# sourced by the store build scripts: exports named keys from dusk.env without echoing them or sourcing the whole file.
#   . "$(dirname "$0")/release-env.sh"; dusk_env_load KEY [KEY...]
DUSK_ENV_FILE="${DUSK_ENV_FILE:-$HOME/.config/duskbot/dusk.env}"

dusk_env_load() {
  [ -r "$DUSK_ENV_FILE" ] || return 0
  for key in "$@"; do
    # a value already in the environment wins
    eval "current=\${$key:-}"
    [ -n "$current" ] && continue
    line=$(grep -m1 "^${key}=" "$DUSK_ENV_FILE" 2>/dev/null || true)
    [ -n "$line" ] || continue
    value=${line#*=}
    case "$value" in \"*\") value=${value#\"}; value=${value%\"} ;; \'*\') value=${value#\'}; value=${value%\'} ;; esac
    export "$key=$value"
  done
  unset current line value
}

# the Firebase config for Android push (public identifiers, kept out of the public repo like the other release inputs):
# ~/.config/duskbot/google-services.json, or DUSK_ANDROID_GOOGLE_SERVICES, copied to where the google-services plugin reads it
dusk_google_services() {
  local src="${DUSK_ANDROID_GOOGLE_SERVICES:-$HOME/.config/duskbot/google-services.json}"
  local dest="$1/android/app/google-services.json"
  [ -f "$src" ] || { echo "error: no $src, so the build would have no push (docs/phone-push.md, Android)" >&2; return 1; }
  grep -q '"package_name": *"bot.dusk.mobile"' "$src" || { echo "error: $src has no client for bot.dusk.mobile" >&2; return 1; }
  install -m 644 "$src" "$dest"
}
