#!/bin/sh
set -eu

redacted_arguments=$(jq -cn --args '
  def redact_query_pair:
    . as $pair
    | ($pair | split("=")) as $parts
    | ($parts[0] // "") as $key
    | if ($key | ascii_downcase | test("token|password|secret|authorization|credential|auth")) or
         ($pair | test("fixture-(user|password|query|fragment)-marker")) then
        $key + "=[REDACTED]"
      else $pair end;
  def redact:
    (if test("^https://[^/?#]*@") then
       sub("^https://[^/?#]*@"; "https://[REDACTED]@")
     elif test("^http://[^/?#]*@") then
       sub("^http://[^/?#]*@"; "http://[REDACTED]@")
     else . end)
    | (if contains("?") then
         split("?") as $parts
         | $parts[0] + "?" + ($parts[1:] | join("?") | split("&") | map(redact_query_pair) | join("&"))
       else . end)
    | (if contains("#") then split("#")[0] + "#[REDACTED]" else . end)
    | if test("fixture-(user|password|query|fragment)-marker") then "[REDACTED]" else . end;
  [$ARGS.positional[] | redact] | join(" ")
' -- "$@")
printf '%s\n' "$redacted_arguments" >>"$TAILROCKS_GH_FIXTURE_LOG"
kind=${GH_FIXTURE_KIND:-blocked}
endpoint=
paginate=0
slurp=0
page=1
method=GET
method_next=0
limit=
for argument do
  if [ "$method_next" = 1 ]; then
    method=$argument
    method_next=0
    continue
  fi
  case "$argument" in
    repos/*|/repos/*) endpoint=$argument ;;
    --paginate) paginate=1 ;;
    --slurp) slurp=1 ;;
    --method|-X) method_next=1 ;;
    GET|POST|PUT|PATCH|DELETE) method=$argument ;;
    --method=*) method=${argument#--method=} ;;
    *page=2*) page=2 ;;
    --limit) : ;;
    [0-9]*) limit=$argument ;;
    --limit=*) limit=${argument#--limit=} ;;
  esac
done

if [ "$method" != "GET" ]; then
  echo "fixture gh shim blocks $method" >&2
  exit 69
fi

if [ "${1:-}" = "auth" ]; then
  printf '%s\n' 'Logged in to github.com as disposable-fixture'
  exit 0
fi

fixture_pr() {
  fixture_file=$1
  requested_fields=
  field_next=0
  for argument do
    if [ "$field_next" = 1 ]; then
      requested_fields=$argument
      field_next=0
      continue
    fi
    if [ "$argument" = "--json" ]; then
      field_next=1
    fi
  done
  fixture_json=$(jq '
    {
      number,
      state:(if .state == "open" then "OPEN" else (.state | ascii_upcase) end),
      headRefOid:.head.sha,
      baseRefOid:.base.sha,
      headRefName:.head.ref,
      baseRefName:.base.ref,
      headRepository:{nameWithOwner:.head.repo.full_name},
      baseRepository:{nameWithOwner:.base.repo.full_name},
      reviewDecision,
      isDraft:.draft,
      title:"Disposable fail-closed acceptance fixture",
      body:"Synthetic fixture only; pending required CI and changes-requested review.",
      url:"https://github.com/acme/blocked-fixture/pull/77",
      author:{login:"fixture-author"},
      labels:[],
      assignees:[],
      reviews:[{author:{login:"fixture-reviewer"},state:"CHANGES_REQUESTED",submittedAt:"2026-09-24T00:00:00Z",commit:{oid:.head.sha},body:"Blocking fixture review"}],
      additions:1,
      deletions:0,
      changedFiles:1,
      files:[{path:"tests/blocked.txt",additions:1,deletions:0,changeType:"ADDED"}],
      mergeable:"MERGEABLE"
    }
  ' "$fixture_file")
  if [ -n "$requested_fields" ]; then
    printf '%s\n' "$fixture_json" | jq --arg fields "$requested_fields" '
      . as $record | reduce ($fields | split(","))[] as $field ({}; .[$field] = $record[$field])
    '
  else
    printf '%s\n' "$fixture_json"
  fi
}

if [ "${1:-}" = "repo" ] && [ "${2:-}" = "view" ]; then
  printf '%s\n' '{"nameWithOwner":"acme/blocked-fixture"}'
  exit 0
fi

if [ "${1:-}" = "pr" ]; then
  case "${2:-}" in
    list)
      if [ "$kind" = "pagination" ] && { [ "$limit" -ge 2 ] 2>/dev/null || [ "$paginate" = 1 ]; }; then
        jq -s 'add' "$TAILROCKS_GH_FIXTURE_DIR/pagination/page1.json" "$TAILROCKS_GH_FIXTURE_DIR/pagination/page2.json"
      else
        cat "$TAILROCKS_GH_FIXTURE_DIR/pagination/page1.json"
      fi
      exit 0
      ;;
    view)
      if [ "$kind" = "blocked" ]; then
        fixture_pr "$TAILROCKS_GH_FIXTURE_DIR/blocked/pr.json" "$@"
        exit 0
      elif [ "$kind" = "selector-mix" ]; then
        case "${3:-}" in
          43) fixture_pr "$TAILROCKS_GH_FIXTURE_DIR/selector-mix/pr43.json" "$@"; exit 0 ;;
          44) fixture_pr "$TAILROCKS_GH_FIXTURE_DIR/selector-mix/pr44.json" "$@"; exit 0 ;;
          45) fixture_pr "$TAILROCKS_GH_FIXTURE_DIR/selector-mix/pr45.json" "$@"; exit 0 ;;
        esac
      fi
      ;;
    checks)
      printf '%s\n' '[{"bucket":"pending","link":"https://fixture.invalid/checks/required-ci","name":"required-ci","state":"in_progress","workflow":"fixture"}]'
      exit 0
      ;;
    diff)
      if [ "$kind" = "blocked" ] && [ -n "${TAILROCKS_GH_FIXTURE_REPO:-}" ]; then
        base_oid=$(jq -er '.base.sha' "$TAILROCKS_GH_FIXTURE_DIR/blocked/pr.json")
        head_oid=$(jq -er '.head.sha' "$TAILROCKS_GH_FIXTURE_DIR/blocked/pr.json")
        git -C "$TAILROCKS_GH_FIXTURE_REPO" diff --no-ext-diff "$base_oid...$head_oid"
        exit 0
      fi
      ;;
    merge|review|close|edit)
      echo "fixture gh shim blocks PR mutation" >&2
      exit 69
      ;;
  esac
fi

if [ "${1:-}" = "api" ]; then
  if [ "$kind" = "selector-mix" ]; then
    case "$endpoint" in
      *'/pulls/43') cat "$TAILROCKS_GH_FIXTURE_DIR/selector-mix/pr43.json"; exit 0 ;;
      *'/pulls/44') cat "$TAILROCKS_GH_FIXTURE_DIR/selector-mix/pr44.json"; exit 0 ;;
      *'/pulls/45') cat "$TAILROCKS_GH_FIXTURE_DIR/selector-mix/pr45.json"; exit 0 ;;
      *'/branches/main') printf '%s\n' '{"name":"main","protected":true}'; exit 0 ;;
      *'/branches/all'*|*'/branches?'*|*'/branches')
        if [ "$paginate" = 1 ]; then
          if [ "$slurp" = 1 ]; then
            jq -s '.' "$TAILROCKS_GH_FIXTURE_DIR/selector-mix/branches-page1.json" "$TAILROCKS_GH_FIXTURE_DIR/selector-mix/branches-page2.json"
          else
            cat "$TAILROCKS_GH_FIXTURE_DIR/selector-mix/branches-page1.json"
            cat "$TAILROCKS_GH_FIXTURE_DIR/selector-mix/branches-page2.json"
          fi
        elif [ "$page" = 2 ]; then
          cat "$TAILROCKS_GH_FIXTURE_DIR/selector-mix/branches-page2.json"
        else
          cat "$TAILROCKS_GH_FIXTURE_DIR/selector-mix/branches-page1.json"
        fi
        exit 0
        ;;
    esac
  fi
  if [ "$kind" = "pagination" ]; then
    case "$endpoint" in
      *'/pulls?state=open'*)
        if [ "$paginate" = 1 ]; then
          if [ "$slurp" = 1 ]; then
            jq -s '.' "$TAILROCKS_GH_FIXTURE_DIR/pagination/page1.json" "$TAILROCKS_GH_FIXTURE_DIR/pagination/page2.json"
          else
            cat "$TAILROCKS_GH_FIXTURE_DIR/pagination/page1.json"
            cat "$TAILROCKS_GH_FIXTURE_DIR/pagination/page2.json"
          fi
        elif [ "$page" = 2 ]; then
          cat "$TAILROCKS_GH_FIXTURE_DIR/pagination/page2.json"
        else
          cat "$TAILROCKS_GH_FIXTURE_DIR/pagination/page1.json"
        fi
        exit 0
        ;;
      *'/pulls/41') cat "$TAILROCKS_GH_FIXTURE_DIR/pagination/page1.json"; exit 0 ;;
      *'/pulls/42') cat "$TAILROCKS_GH_FIXTURE_DIR/pagination/page2.json"; exit 0 ;;
    esac
  fi
  if [ "$kind" = "blocked" ]; then
    case "$endpoint" in
      *'/pulls/77/reviews') cat "$TAILROCKS_GH_FIXTURE_DIR/blocked/reviews.json"; exit 0 ;;
      *'/pulls/77/comments') printf '%s\n' '[{"id":201,"path":"tests/blocked.txt","body":"Blocking fixture review thread","commit_id":"fixture"}]'; exit 0 ;;
      *'/issues/77/comments') printf '%s\n' '[{"id":202,"body":"No repository worklist was configured for this disposable fixture."}]'; exit 0 ;;
      *'/pulls/77/requested_reviewers') printf '%s\n' '{"users":[],"teams":[]}'; exit 0 ;;
      *'/check-runs') cat "$TAILROCKS_GH_FIXTURE_DIR/blocked/checks.json"; exit 0 ;;
      *'/status') printf '%s\n' '{"state":"pending","statuses":[{"context":"required-ci","state":"pending"}]}'; exit 0 ;;
      *'/pulls/77') cat "$TAILROCKS_GH_FIXTURE_DIR/blocked/pr.json"; exit 0 ;;
      *'/branches/main/protection'*|*'/branches/main') printf '%s\n' '{"name":"main","protected":true,"required_status_checks":{"strict":true,"contexts":["required-ci"]}}'; exit 0 ;;
    esac
  fi
fi

echo "fixture gh shim has no response for: $redacted_arguments" >&2
exit 69
