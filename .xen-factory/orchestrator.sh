#!/usr/bin/env bash
# xen-factory orchestrator
#
# Walks one target repo's open GitHub issues right-to-left through the pipeline
# states, handing each actionable issue to a dedicated local opencode agent.
# One issue per agent run; one orchestrator instance at a time (flock).
#
# Project-agnostic: every per-repo value lives in .xen-factory/config.json.
# Portable by design: agents run inside a per-issue git worktree and rely on gh's
# cwd auto-detection, so nothing hardcodes an owner/repo.
#
# Isolation: each issue gets its own worktree at .xen-factory/worktrees/<N> and the
# agent runs with cwd there. The main checkout stays on the base branch, so a foreign
# commit in the main tree can never tangle an in-flight issue's branch.
set -euo pipefail

# --- Locate the target repo --------------------------------------------------
# Default to the repo this script lives in (two levels up from .xen-factory/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${XEN_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
STATE_DIR="$REPO_DIR/.xen-factory"
CONFIG="${XEN_CONFIG:-$STATE_DIR/config.json}"

if [[ ! -f "$CONFIG" ]]; then
  echo "xen-factory: no config at $CONFIG" >&2
  echo "hint: cp .xen-factory/config.example.json .xen-factory/config.json and edit it" >&2
  exit 1
fi
cfg() { jq -r "$1" "$CONFIG"; }

REPO="$(cfg '.repo')"
HUMAN="$(cfg '.human')"
BASE_BRANCH="$(cfg '.base_branch // "main"')"
BRANCH_PREFIX="$(cfg '.branch_prefix // "factory"')"

LOG="${XEN_LOG:-$STATE_DIR/orchestrator.log}"
STATS_LOG="${XEN_STATS_LOG:-$STATE_DIR/stats.jsonl}"
LOCK="$STATE_DIR/orchestrator.lock"
WORKTREE_ROOT="$STATE_DIR/worktrees"
ISSUE_TIMEOUT="${ISSUE_TIMEOUT:-$(cfg '.issue_timeout // 3600')}"
MAX_ITERS="${MAX_ITERS:-$(cfg '.max_iters // 40')}"
OC_BIN="${XEN_OPENCODE:-$(command -v opencode || echo "$HOME/.opencode/bin/opencode")}"

# Detect the opencode CLI generation so this works on both.
#   V1: `run --dir <repo> --dangerously-skip-permissions`
#   V2: cwd defines the directory; auto-approve is `--auto`
OC_AUTO_FLAG="--auto"
if ! "$OC_BIN" run --help 2>&1 | grep -q -- '--auto'; then
  OC_AUTO_FLAG="--dangerously-skip-permissions"
fi
# Legacy global flag retained only for agents' own shell-outs to the vision agent
# (older skills interpolate $XEN_OC_DIR_FLAG). Dispatch builds its own --dir per
# worktree, because the cwd is no longer the main repo.
OC_HAS_DIR_FLAG=false
if "$OC_BIN" run --help 2>&1 | grep -q -- '--dir'; then
  OC_HAS_DIR_FLAG=true
fi
export OC_HAS_DIR_FLAG
# Ancillary shell-outs (the vision agent) still receive an explicit dir on V1; the
# main repo is correct for them and keeps older skills working unchanged. Dispatch
# itself builds its own --dir per worktree (see run_agent).
XEN_OC_DIR_FLAG=""
if [[ "$OC_HAS_DIR_FLAG" == true ]]; then XEN_OC_DIR_FLAG="--dir $REPO_DIR"; fi
# Exposed to agents so their skill shell-outs (e.g. the vision agent) match this CLI.
export XEN_OC_BIN="$OC_BIN"
export XEN_OC_AUTO_FLAG="$OC_AUTO_FLAG"
export XEN_OC_DIR_FLAG="$XEN_OC_DIR_FLAG"

mkdir -p "$STATE_DIR"

# --- Export per-repo values for agents ---------------------------------------
# Agents (and their skills) read these instead of hardcoding anything.
export XEN_REPO="$REPO"
export XEN_HUMAN="$HUMAN"
export XEN_BASE_BRANCH="$BASE_BRANCH"
export XEN_BRANCH_PREFIX="$BRANCH_PREFIX"
export XEN_DIR="$REPO_DIR"
export XEN_CONFIG="$CONFIG"
# Shared runtime state (config, lock, log, stats, chore-state, pr-body temp files)
# lives at the main repo's .xen-factory/ — NOT in a worktree copy. Agents resolve it
# via this env var so they never relativize into their worktree's .xen-factory/.
export XEN_STATE_DIR="$STATE_DIR"

export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.opencode/bin:${PATH:-}"
export GH_FORCE_TTY=0
# Run child `opencode run` as a clean top-level process.
unset OPENCODE OPENCODE_PID OPENCODE_PROCESS_ROLE OPENCODE_RUN_ID \
      OPENCODE_SERVER_PASSWORD OPENCODE_SERVER_USERNAME 2>/dev/null || true

log() { echo "$(date -Is) $*" >> "$LOG"; }

# gh relies on the repo being the cwd. Cron runs us from $HOME, where every gh
# call fails and gets swallowed as "(non-fatal)" — sweeps silently no-op
# (artos#3 retro: green pass-end logs masked dead work).
cd "$REPO_DIR"

# Self-heal the workflow label set: the sweep's add-label fails silently when a
# label doesn't exist repo-side, so a fresh/renamed repo starves invisibly.
have_labels="$(gh label list --limit 100 --json name --jq '.[].name' 2>/dev/null || true)"
for lbl in state:backlog state:needs-requirements state:needs-design \
           state:needs-dev-work state:needs-review state:needs-testing \
           state:needs-more-info state:blocked chore \
           priority:low priority:medium priority:high; do
  if ! grep -qxF "$lbl" <<<"$have_labels"; then
    if gh label create "$lbl" --color C5DEF5 --description "xen-factory workflow label" >/dev/null 2>&1; then
      log "[labels] created missing label $lbl"
    else
      log "[labels] WARNING: could not create $lbl — check gh auth/repo access"
    fi
  fi
done
now_epoch() { date -u +%s; }

# --- Stats (structured JSONL event stream) -----------------------------------
# One JSON object per line. String fields are escaped; everything else is bare.
emit_event() {
  local k v s out ts
  ts="$(date -Is)"
  out="{\"ts\":\"$ts\""
  for arg in "$@"; do
    k="${arg%%=*}"; v="${arg#*=}"
    case "$k" in
      event|agent|outcome|state|restored_state|reason|blocker_state|tier|chore|action|last_fire_date)
        s="${v//\\/\\\\}"; s="${s//\"/\\\"}"
        out="$out,\"$k\":\"$s\"" ;;
      *)
        out="$out,\"$k\":$v" ;;
    esac
  done
  printf '%s\n' "$out}" >> "$STATS_LOG"
}

# --- Single-instance lock ----------------------------------------------------
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "$(date -Is) [skip] another orchestrator instance is already running" >> "$LOG"
  emit_event event=skip reason=lock_held
  exit 0
fi

# --- Model selection ---------------------------------------------------------
# Default: the single model named in config. Optional quota-based tiering picks
# between large/small/local based on remaining weekly tokens, reserving 1/3 of
# usage for the human. Tiering is OFF by default and falls back to local config
# on any error.
CURRENT_MODEL="$(cfg '.model')"
CURRENT_VISION_MODEL="$(cfg '.vision_model')"
CURRENT_TIER="fixed"

refresh_tier() {
  [[ "$(cfg '.tiering.enabled // false')" == "true" ]] || return 0
  local auth url keypath key pct tier
  auth="$(cfg '.tiering.auth_file')"; auth="${auth/#\~/$HOME}"
  url="$(cfg '.tiering.quota_url')"
  keypath="$(cfg '.tiering.auth_key_path // ".synthetic.key"')"
  key="$(jq -r "$keypath // empty" "$auth" 2>/dev/null)" || true
  if [[ -z "$key" ]]; then
    log "[tier] no key at $auth ($keypath) — using local tier"
    tier=local
  else
    pct="$(curl -s --max-time 5 "$url" -H "Authorization: Bearer $key" \
          | jq -r '.weeklyTokenLimit.percentRemaining // empty' 2>/dev/null)" || true
    if [[ -z "$pct" ]]; then
      log "[tier] quota API failed — using local tier"; tier=local
    else
      tier="$(awk -v p="$pct" 'BEGIN{
        if (p >= 50) print "large"; else if (p >= 33.333333) print "small"; else print "local" }')"
      log "[tier] percentRemaining=${pct}% → tier=${tier}"
    fi
  fi
  CURRENT_TIER="$tier"
  CURRENT_MODEL="$(cfg ".tiering.${tier}.text")"
  CURRENT_VISION_MODEL="$(cfg ".tiering.${tier}.vision")"
}
refresh_tier
export XEN_TIER="$CURRENT_TIER"
export XEN_VISION_MODEL="$CURRENT_VISION_MODEL"

# --- State -> agent mapping (right to left priority) -------------------------
# state:needs-more-info is intentionally absent: it is human-owned.
states=(
  state:needs-testing
  state:needs-review
  state:needs-dev-work
  state:needs-design
  state:needs-requirements
  state:backlog
)
declare -A agent_of=(
  [state:needs-testing]=quality-assurance
  [state:needs-review]=code-review
  [state:needs-dev-work]=developer
  [state:needs-design]=tech-analyst
  [state:needs-requirements]=product-owner
  [state:backlog]=product-manager
)

# --- Per-issue git worktrees (isolation) -------------------------------------
# Each issue gets its own worktree so the main checkout stays on the base branch and
# can never be entangled by an outside commit. Worktree path is derived, never
# hardcoded. Creation is idempotent so dev → review → QA across passes reuse one
# checkout. Runtime state stays in the main tree (XEN_STATE_DIR).
WORKTREES_OK=true
if ! git -C "$REPO_DIR" worktree list >/dev/null 2>&1; then
  WORKTREES_OK=false
  log "[worktree] git worktree is unavailable in $REPO_DIR — dispatches will be refused"
fi

worktree_path() { printf '%s/%s' "$WORKTREE_ROOT" "$1"; }

worktree_ensure() {
  local n="$1" branch="$2" wt
  wt="$(worktree_path "$n")"
  if [[ "$WORKTREES_OK" != true ]]; then
    log "[worktree] issue #$n refused: git worktree unavailable"
    emit_event event=worktree issue=$n action=skip reason=worktree_unavailable
    return 1
  fi
  git -C "$REPO_DIR" worktree prune >/dev/null 2>&1 || true

  # Already registered → reuse as-is (preserves branch state across passes).
  if git -C "$REPO_DIR" worktree list --porcelain 2>/dev/null \
       | grep -qxF "worktree $wt"; then
    log "[worktree] issue #$n reuse $wt ($branch)"
    emit_event event=worktree issue=$n action=reuse
    printf '%s' "$wt"; return 0
  fi
  # A leftover directory that is not registered → clear it before adding.
  if [[ -e "$wt" ]]; then
    rm -rf "$wt"
  fi

  # The base branch cannot be checked out in two worktrees at once; refuse loudly
  # rather than silently falling back to the colliding shared tree.
  if [[ "$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)" == "$branch" ]]; then
    log "[worktree] issue #$n refused: main checkout is already on $branch"
    emit_event event=worktree issue=$n action=skip reason=main_on_branch
    return 1
  fi

  mkdir -p "$WORKTREE_ROOT"
  if git -C "$REPO_DIR" show-ref --verify --quiet "refs/heads/$branch"; then
    if git -C "$REPO_DIR" worktree add "$wt" "$branch" >/dev/null 2>&1; then
      log "[worktree] issue #$n create $wt ($branch, existing)"
      emit_event event=worktree issue=$n action=create
      printf '%s' "$wt"; return 0
    fi
  else
    if git -C "$REPO_DIR" fetch origin "$BASE_BRANCH" >/dev/null 2>&1 \
       && git -C "$REPO_DIR" worktree add -b "$branch" "$wt" "origin/$BASE_BRANCH" >/dev/null 2>&1; then
      log "[worktree] issue #$n create $wt ($branch, from origin/$BASE_BRANCH)"
      emit_event event=worktree issue=$n action=create
      printf '%s' "$wt"; return 0
    fi
  fi

  log "[worktree] issue #$n refused: git worktree add failed for $wt ($branch)"
  emit_event event=worktree issue=$n action=skip reason=add_failed
  return 1
}

worktree_remove() {
  local n="$1" branch="$2" wt
  wt="$(worktree_path "$n")"
  [[ -d "$wt" ]] || return 0
  if git -C "$REPO_DIR" worktree remove --force "$wt" >/dev/null 2>&1; then
    git -C "$REPO_DIR" worktree prune >/dev/null 2>&1 || true
    git -C "$REPO_DIR" branch -D "$branch" >/dev/null 2>&1 || true
    log "[worktree] issue #$n removed $wt"
    emit_event event=worktree issue=$n action=remove
  else
    log "[worktree] issue #$n remove failed for $wt"
    emit_event event=worktree issue=$n action=skip reason=remove_failed
  fi
}

# Remove the worktree of a just-handled issue once it is closed.
cleanup_closed_worktree() {
  local n="$1" branch="$2" st
  st="$(gh issue view "$n" --json state --jq '.state' 2>/dev/null)" || st=""
  if [[ "$st" == "CLOSED" ]]; then
    worktree_remove "$n" "$branch"
  fi
}

# Safety net: prune any managed worktree whose issue is closed or no longer exists.
sweep_worktrees() {
  [[ -d "$WORKTREE_ROOT" ]] || { git -C "$REPO_DIR" worktree prune >/dev/null 2>&1 || true; return 0; }
  local wt n st
  while IFS= read -r wt; do
    [[ -z "$wt" ]] && continue
    n="$(basename "$wt")"
    [[ "$n" =~ ^[0-9]+$ ]] || continue
    st="$(gh issue view "$n" --json state --jq '.state' 2>/dev/null)" || st=""
    if [[ "$st" != "OPEN" ]]; then
      log "[worktree] sweep issue #$n ($st) — removing stale worktree"
      worktree_remove "$n" "$BRANCH_PREFIX/$n"
    fi
  done < <(find "$WORKTREE_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)
  git -C "$REPO_DIR" worktree prune >/dev/null 2>&1 || true
}

# --- Sweeps ------------------------------------------------------------------
# gh auto-detects the repo from cwd, so no --repo anywhere.
sweep_backlog() {
  gh issue list --state open --json number,labels \
    --jq '.[] | select((.labels | map(.name) | any(. | startswith("state:"))) | not) | .number' \
    2>/dev/null | while read -r n; do
    [[ -z "$n" ]] && continue
    if gh issue edit "$n" --add-label "state:backlog" >/dev/null 2>&1; then
      log "[sweep] issue #$n auto-labeled state:backlog"
      emit_event event=sweep_backlog issue=$n
    fi
  done
}

sweep_blocked() {
  gh issue list --label "state:blocked" --state open --json number --jq '.[].number' 2>/dev/null \
  | while read -r n; do
    [[ -z "$n" ]] && continue
    body="$(gh issue view "$n" --json comments \
      --jq '.comments | map(select(.body | startswith("## Blocked"))) | last | .body // empty' 2>/dev/null)" || true
    if [[ -z "$body" ]]; then
      log "[sweep-blocked] issue #$n has state:blocked but no '## Blocked' comment; leaving for human"
      emit_event event=sweep_blocked_malformed issue=$n reason="no_blocked_comment"
      continue
    fi
    blocker="$(printf '%s\n' "$body" | grep -oE 'Blocked by #[0-9]+' | grep -oE '[0-9]+' | head -1)"
    prev="$(printf '%s\n' "$body" | grep -oE 'Was: state:[a-z-]+' | grep -oE 'state:[a-z-]+' | head -1)"
    if [[ -z "$blocker" ]]; then
      log "[sweep-blocked] issue #$n '## Blocked' has no 'Blocked by #N'; auto-clearing"
      emit_event event=sweep_blocked_malformed issue=$n reason="no_blocker_id"
      [[ -z "$prev" ]] && prev="state:backlog"
      if gh issue edit "$n" --remove-label "state:blocked" --add-label "$prev" >/dev/null 2>&1; then
        gh issue comment "$n" --body "Auto-cleared \`state:blocked\`: the latest \`## Blocked\` comment names no blocker (\`Blocked by #N\` missing). Restoring \`$prev\`." >/dev/null 2>&1
        log "[sweep-blocked] issue #$n invalid block auto-cleared; returning to $prev"
      fi
      continue
    fi
    [[ -z "$prev" ]] && prev="state:backlog"
    bstate="$(gh issue view "$blocker" --json state --jq '.state' 2>/dev/null)" || true
    emit_event event=sweep_blocked_scan issue=$n blocker=$blocker blocker_state=$bstate
    if [[ "$bstate" == "CLOSED" ]]; then
      if gh issue edit "$n" --remove-label "state:blocked" --add-label "$prev" >/dev/null 2>&1; then
        gh issue comment "$n" --body "Unblocked — #$blocker closed. Returning to \`$prev\`." >/dev/null 2>&1
        log "[unblock] issue #$n unblocked (blocker #$blocker closed); returning to $prev"
        emit_event event=unblock issue=$n blocker=$blocker restored_state=$prev
      fi
    fi
  done
}

# --- Recurring chore generator (one generic chore) ---------------------------
# Creates at most one chore issue per UTC day, only when >=1 non-chore issue has
# closed since the last fire. Idempotent; non-fatal. State in chore-state.json.
CHORE_STATE="$STATE_DIR/chore-state.json"
_jq_state() { local tmp; tmp="$(mktemp)"; jq "$@" "$CHORE_STATE" > "$tmp" 2>/dev/null && mv "$tmp" "$CHORE_STATE" || rm -f "$tmp"; }

sweep_chores() {
  [[ "$(cfg '.chore.enabled // false')" == "true" ]] || return 0
  local name template title_prefix display today now lfd since worked_since open_count body recent new_issue
  name="$(cfg '.chore.name // "code-maintenance"')"
  template="$(cfg '.chore.template // ".xen-factory/templates/code-maintenance.md"')"
  [[ "$template" != /* ]] && template="$REPO_DIR/$template"
  display="$name"; title_prefix="chore: $name"
  today="$(date -u +%Y-%m-%d)"; now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  gh label create chore --color FEF2C0 --description "Recurring maintenance chore" >/dev/null 2>&1 || true

  [[ -f "$CHORE_STATE" ]] || jq -n '{ "code-maintenance": {"last_tick":null,"last_fire_date":null,"last_fire_issue":null} }' > "$CHORE_STATE" 2>/dev/null || true
  if ! jq -e . "$CHORE_STATE" >/dev/null 2>&1; then
    log "[chore] chore-state.json is malformed; aborting chore sweep (non-fatal)"; return 1
  fi

  lfd="$(jq -r --arg t "$name" '.[$t].last_fire_date // empty' "$CHORE_STATE" 2>/dev/null)" || lfd=""
  since="${lfd:-2000-01-01}"

  if [[ -n "$lfd" && "$today" == "$lfd" ]]; then
    log "[chore] $name already fired today ($lfd); skipping"
    emit_event event=chore_tick chore="$name" last_fire_date="$lfd" worked_since=0 action=skip
    emit_event event=chore_skip chore="$name" reason=already_fired_today
    _jq_state --arg t "$name" --arg n "$now" '.[$t].last_tick = $n'; return 0
  fi

  worked_since="$(gh issue list --state closed --search "closed:>=$since" --json number,labels \
    --jq '[.[] | select((.labels | map(.name) | any(. == "chore")) | not)] | length' 2>/dev/null)" || worked_since=0
  worked_since="${worked_since:-0}"

  open_count="$(gh issue list --state open --label chore --json number,title \
    --jq '[.[] | select(.title | startswith("'"$title_prefix"'"))] | length' 2>/dev/null)" || open_count=0
  open_count="${open_count:-0}"
  if (( open_count > 0 )); then
    log "[chore] $name already has an open chore; skipping (open_exists)"
    emit_event event=chore_tick chore="$name" last_fire_date="${lfd:-}" worked_since="$worked_since" action=skip
    emit_event event=chore_skip chore="$name" reason=open_exists
    _jq_state --arg t "$name" --arg n "$now" '.[$t].last_tick = $n'; return 0
  fi
  if (( worked_since == 0 )); then
    log "[chore] $name no non-chore work since $since; skipping (no_work_since_last)"
    emit_event event=chore_tick chore="$name" last_fire_date="${lfd:-}" worked_since=0 action=skip
    emit_event event=chore_skip chore="$name" reason=no_work_since_last
    _jq_state --arg t "$name" --arg n "$now" '.[$t].last_tick = $n'; return 0
  fi

  body="$(cat "$template" 2>/dev/null)" || body="(template missing: $template)"
  recent="$(gh issue list --state closed --search "closed:>=$since" --json number,labels \
    --jq '[.[] | select((.labels | map(.name) | any(. == "chore")) | not) | .number] | sort | .[] | "- #" + tostring' 2>/dev/null)" || recent=""
  recent="${recent:-(none)}"
  body="${body//\{\{recently_closed\}\}/$recent}"

  # gh issue create prints the issue URL — there is no --json flag for create.
  local url
  url="$(gh issue create --title "chore: $display ($today)" --body "$body" \
    --label chore --label priority:low --label state:needs-dev-work 2>/dev/null)" || url=""
  new_issue="$(printf '%s' "$url" | grep -oE '[0-9]+$')" || new_issue=""
  if [[ -z "$new_issue" ]]; then
    log "[chore] $name failed to create chore issue (gh error); skipping"
    emit_event event=chore_tick chore="$name" last_fire_date="${lfd:-}" worked_since="$worked_since" action=skip
    emit_event event=chore_skip chore="$name" reason=create_failed
    _jq_state --arg t "$name" --arg n "$now" '.[$t].last_tick = $n'; return 0
  fi
  log "[chore] $name created chore issue #$new_issue (worked_since=$worked_since)"
  emit_event event=chore_tick chore="$name" last_fire_date="$today" worked_since="$worked_since" action=create
  emit_event event=chore_create chore="$name" issue=$new_issue based_on_work=$worked_since
  _jq_state --arg t "$name" --arg n "$now" --arg d "$today" --argjson i "$new_issue" \
    '.[$t].last_tick=$n | .[$t].last_fire_date=$d | .[$t].last_fire_issue=$i'
  return 0
}

# --- Dispatch ----------------------------------------------------------------
# Issues already handled in a given state during THIS pass (key "<issue>:<state>").
# Guards against GitHub's eventually-consistent label index: right after an agent
# moves an issue OUT of a state, `gh issue list --label <state>` can still report
# the old label for a second or two, which would re-queue and re-run the same agent
# (the "double code-review" waste). One judgment per issue per state per pass.
declare -A handled=()

first_issue_in() {
  local label="$1" cand
  while IFS= read -r cand; do
    [[ -z "$cand" ]] && continue
    if [[ -z "${handled[$cand:$label]:-}" ]]; then
      printf '%s' "$cand"; return 0
    fi
  done < <(gh issue list --label "$label" --state open --json number --jq '.[].number' 2>/dev/null || true)
  return 0
}

run_agent() {
  local a="$1" n="$2" wt="$3" model prompt start rc
  if [[ "$a" == "vision" ]]; then model="$CURRENT_VISION_MODEL"; else model="$CURRENT_MODEL"; fi
  prompt="Work GitHub issue #$n in repo $XEN_REPO. Load your \"$a\" skill and follow its workflow for this issue exactly. Make the required GitHub updates and transition the issue's state label as the skill directs. Only work issue #$n in this run. When finished, reply with a one-line summary of what you did."
  # V1 needs --dir; V2 uses cwd. Build the dir flag per-worktree (not the shared repo).
  local dir_arg=""
  if [[ "$OC_HAS_DIR_FLAG" == true ]]; then dir_arg="--dir $wt"; fi
  log "[run] agent=$a issue=#$n start model=$model cwd=$wt"
  emit_event event=run_start agent=$a issue=$n tier=$CURRENT_TIER
  start="$(now_epoch)"
  # Run from the issue's worktree: V2 uses cwd as the directory; V1 gets --dir.
  if ( cd "$wt" && timeout "${ISSUE_TIMEOUT}s" "$OC_BIN" run \
       --agent "$a" $dir_arg --model "$model" \
       "$OC_AUTO_FLAG" "$prompt" ) >> "$LOG" 2>&1; then
    log "[run] agent=$a issue=#$n done"
    emit_event event=run_end agent=$a issue=$n outcome=done duration_s=$(( $(now_epoch) - start ))
    return 0
  else
    rc=$?
    log "[run] agent=$a issue=#$n FAILED (rc=$rc)"
    emit_event event=run_end agent=$a issue=$n outcome=failed duration_s=$(( $(now_epoch) - start )) rc=$rc
    return 1
  fi
}

# --- Main loop ---------------------------------------------------------------
log "=== orchestrator pass start (repo=$REPO tier=$CURRENT_TIER model=$CURRENT_MODEL) ==="
emit_event event=pass_start
# Sweeps are best-effort: a failing gh call (no auth, transient network, empty repo)
# must never abort the whole pass.
sweep_backlog || log "[sweep] sweep_backlog failed (non-fatal)"
sweep_blocked || log "[sweep] sweep_blocked failed (non-fatal)"
sweep_chores  || log "[chore] sweep_chores failed (non-fatal)"
sweep_worktrees || log "[sweep] sweep_worktrees failed (non-fatal)"

iter=0
exhausted=false
while (( iter < MAX_ITERS )); do
  iter=$((iter + 1))
  worked=false
  for s in "${states[@]}"; do
    n="$(first_issue_in "$s")"
    if [[ -n "$n" ]]; then
      a="${agent_of[$s]}"
      log "[pick] state=$s agent=$a issue=#$n"
      emit_event event=pick agent=$a issue=$n state=$s
      handled["$n:$s"]=1
      branch="$BRANCH_PREFIX/$n"
      wt="$(worktree_ensure "$n" "$branch")" || {
        log "[worktree] issue #$n not dispatched (worktree unavailable)"
        continue
      }
      run_agent "$a" "$n" "$wt" || true
      cleanup_closed_worktree "$n" "$branch"
      worked=true
      break
    fi
  done
  if [[ "$worked" == "false" ]]; then
    log "[done] no actionable issues (only needs-more-info or empty); exiting loop"
    break
  fi
  # Loop ended because the cap was reached, not because work ran out.
  (( iter >= MAX_ITERS )) && exhausted=true
done

if [[ "$exhausted" == true ]]; then
  log "[warn] hit MAX_ITERS=$MAX_ITERS; stopping for safety"
  emit_event event=max_iters_hit iter=$iter
fi
log "=== orchestrator pass end ==="
emit_event event=pass_end
