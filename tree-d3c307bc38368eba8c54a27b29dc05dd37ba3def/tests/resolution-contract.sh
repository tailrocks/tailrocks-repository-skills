#!/bin/sh
set -eu

helper_bin=$(printenv TAILROCKS_HELPER_BIN 2>/dev/null || true)
if [ -z "$helper_bin" ]; then
  cargo build --quiet --locked --manifest-path helper/Cargo.toml
  helper_bin="$PWD/helper/target/debug/tailrocks-repository-helper"
fi

work=$(mktemp -d /tmp/tailrocks-resolution.XXXXXX)
trap 'rm -rf "$work"' EXIT HUP INT TERM
repo="$work/repo"
state="$work/state"
gh="$work/gh"
gh_log="$work/gh.log"

git init -q -b main "$repo"
git -C "$repo" config user.name Fixture
git -C "$repo" config user.email fixture@example.invalid
printf 'base\n' >"$repo/base.txt"
git -C "$repo" add base.txt
git -C "$repo" commit -qm base
git -C "$repo" branch release/next
git -C "$repo" checkout -q -b feature/auth
printf 'auth\n' >"$repo/auth.txt"
git -C "$repo" add auth.txt
git -C "$repo" commit -qm auth
git -C "$repo" checkout -q release/next
git -C "$repo" remote add origin git@github.com:acme/one.git
feature_oid=$(git -C "$repo" rev-parse feature/auth)
main_oid=$(git -C "$repo" rev-parse main)
git -C "$repo" update-ref refs/remotes/origin/feature/auth "$feature_oid"

cat >"$gh" <<'EOF'
#!/bin/sh
set -eu
endpoint=
for argument in "$@"; do
  endpoint=$argument
done
printf '%s\n' "$*" >>"$GH_LOG"
case "$endpoint" in
  repos/acme/one/pulls/42)
    printf '%s\n' '{"number":42,"state":"open","draft":false,"head":{"ref":"feature/auth","sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"base":{"ref":"main","sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","repo":{"full_name":"acme/one"}}}'
    ;;
  repos/acme/one/pulls\?*)
    printf '%s\n' '[[{"number":42,"state":"open","draft":false,"head":{"ref":"feature/auth","sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"base":{"ref":"main","sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","repo":{"full_name":"acme/one"}}},{"number":43,"state":"open","draft":true,"head":{"ref":"feature/usage","sha":"cccccccccccccccccccccccccccccccccccccccc"},"base":{"ref":"release/next","sha":"dddddddddddddddddddddddddddddddddddddddd","repo":{"full_name":"acme/one"}}}]]'
    ;;
  repos/acme/one/branches\?*)
    printf '%s\n' '[[{"name":"release/next","protected":true,"commit":{"sha":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}},{"name":"feature/auth","protected":false,"commit":{"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}},{"name":"maintenance","protected":true,"commit":{"sha":"ffffffffffffffffffffffffffffffffffffffff"}}]]'
    ;;
  *)
    echo "unexpected gh endpoint: $endpoint" >&2
    exit 1
    ;;
esac
EOF
chmod +x "$gh"

request="$work/request.json"
"$helper_bin" parse-request --text \
  "--repo=acme/one --target-branch=release/next feature/auth #42 https://github.com/acme/one/pulls?state=open&page=2" \
  >"$request"
resolved=$(TAILROCKS_GH_BIN="$gh" GH_LOG="$gh_log" "$helper_bin" resolve-selectors \
  --repo-path "$repo" --request-file "$request")
printf '%s\n' "$resolved" | jq -e '
  .schema == "tailrocks.source-resolution/v1" and
  .repository == "acme/one" and
  (.sources | map(.canonical) | sort) ==
    ["branch:feature/auth", "pr:acme/one#42", "pr:acme/one#43"]
' >/dev/null
printf '%s\n' "$resolved" | jq -e '
  any(.sources[]; .canonical == "pr:acme/one#43" and .draft == true and
      .base_branch == "release/next" and .provenance[0] ==
      "https://github.com/acme/one/pulls?state=open&page=2")
' >/dev/null
rg -q -- '--paginate --slurp' "$gh_log"

branches_request="$work/branches-request.json"
"$helper_bin" parse-request --text \
  "--repo=acme/one --target-branch=release/next https://github.com/acme/one/branches/all?page=2" \
  >"$branches_request"
branches=$(TAILROCKS_GH_BIN="$gh" GH_LOG="$gh_log" "$helper_bin" resolve-selectors \
  --repo-path "$repo" --request-file "$branches_request")
printf '%s\n' "$branches" | jq -e '
  (.sources | map(.canonical) | sort) == ["branch:feature/auth", "branch:maintenance"]
' >/dev/null

git -C "$repo" update-ref refs/remotes/upstream/feature/auth "$main_oid"
if "$helper_bin" resolve-selectors --repo-path "$repo" --request-file "$request" \
  >"$work/ambiguous.out" 2>"$work/ambiguous.err"; then
  echo "ambiguous branch unexpectedly resolved" >&2
  exit 1
fi

echo "selector resolution: PASS"
