#!/bin/bash
# task-sidebar — comprehensive verification battery
#
# Runs against the server at $BASE (default http://127.0.0.1:5174) and the
# vault at $VAULT_ROOT (default ./sample-vault). The default shape assumes
# the bundled sample vault; forkers pointing at their own vault should set
# VAULT_ROOT + TEST_PROJECT_SLUG to match.
#
# All path operations are env-driven — zero hardcoded user paths.
set +e

BASE="${BASE:-http://127.0.0.1:5174}"
VAULT_ROOT="${VAULT_ROOT:-$(pwd)/sample-vault}"
TEST_PROJECT_SLUG="${TEST_PROJECT_SLUG:-demo-app}"
TEST_INLINE_LINE="${TEST_INLINE_LINE:-12}"
TEST_TASKS_MD="$VAULT_ROOT/1-Projects/$TEST_PROJECT_SLUG/tasks.md"

# Thresholds scaled for sample-vault (3 projects, ~25 tasks). Override via env
# if running against a larger vault.
MIN_PROJECTS="${MIN_PROJECTS:-2}"
MIN_TASKS="${MIN_TASKS:-10}"
MIN_ENTITY_TASKS="${MIN_ENTITY_TASKS:-2}"

RESULTS=()
pass(){ RESULTS+=("✅ $1"); }
fail(){ RESULTS+=("❌ $1"); }

# ── READ ENDPOINTS ─────────────────────────────────────────────
echo "=== READ endpoints ==="
VAULT=$(curl -s -m 5 $BASE/api/vault)
[ -n "$VAULT" ] && pass "GET /api/vault returns JSON" || fail "GET /api/vault empty"

PROJ_COUNT=$(echo "$VAULT" | python3 -c "import json,sys;print(len(json.load(sys.stdin)['projects']))")
TASK_COUNT=$(echo "$VAULT" | python3 -c "import json,sys;d=json.load(sys.stdin);print(sum(len(p['tasks']) for p in d['projects']))")
ENTITY_COUNT=$(echo "$VAULT" | python3 -c "import json,sys;d=json.load(sys.stdin);print(sum(1 for p in d['projects'] for t in p['tasks'] if t.get('source')=='entity'))")
INFERRED_PROJ=$(echo "$VAULT" | python3 -c "import json,sys;d=json.load(sys.stdin);print(sum(1 for p in d['projects'] if 'progress' in p))")
# Absolute-path leak check: response must be vault-relative only (Lock #7).
ABS_PATHS=$(echo "$VAULT" | grep -cE '"[A-Za-z]*[Pp]ath":"/[^"]' || true)

[ "$PROJ_COUNT" -ge "$MIN_PROJECTS" ] && pass "projects indexed: $PROJ_COUNT" || fail "too few projects: $PROJ_COUNT"
[ "$TASK_COUNT" -ge "$MIN_TASKS" ] && pass "tasks total: $TASK_COUNT" || fail "too few tasks: $TASK_COUNT"
[ "$ENTITY_COUNT" -ge "$MIN_ENTITY_TASKS" ] && pass "entity tasks: $ENTITY_COUNT" || fail "entity tasks low: $ENTITY_COUNT"
[ "$INFERRED_PROJ" -ge "$MIN_PROJECTS" ] && pass "projects w/ inferred counts: $INFERRED_PROJ" || fail "inferred fields missing"
[ "$ABS_PATHS" -eq 0 ] && pass "zero absolute path leakage" || fail "abs paths leaked: $ABS_PATHS"

# ── SSE endpoint ─────────────────────────────────────────────
SSE_CODE=$(curl -s -m 1 -o /dev/null -w "%{http_code}" -H "Accept: text/event-stream" $BASE/api/events)
[ "$SSE_CODE" = "200" ] && pass "SSE endpoint /api/events (200)" || fail "SSE $SSE_CODE"

# ── SAFETY ─────────────────────────────────────────────────
echo "=== Safety ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -XPOST $BASE/api/tasks/toggle -H 'content-type: application/json' -d '{"tasksPath":"4-Archive/x/tasks.md","line":1,"done":true}')
[ "$CODE" = "403" ] && pass "4-Archive blocked (403)" || fail "4-Archive $CODE"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -XPOST $BASE/api/tasks/toggle -H 'content-type: application/json' -d '{"tasksPath":"Templates/foo.md","line":1,"done":true}')
[ "$CODE" = "403" ] && pass "Templates blocked (403)" || fail "Templates $CODE"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -XPOST $BASE/api/tasks/toggle -H 'content-type: application/json' -d '{"tasksPath":"../../etc/passwd","line":1,"done":true}')
[ "$CODE" = "403" ] && pass "Path traversal blocked (403)" || fail "Traversal $CODE"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -XPOST $BASE/api/tasks/toggle -H 'content-type: application/json' -d 'not-json')
[ "$CODE" = "400" ] && pass "Invalid JSON (400)" || fail "JSON $CODE"

# Find an existing entity task to probe field-edit against (first entity in vault).
ENT_PROBE=$(echo "$VAULT" | python3 -c "import json,sys;d=json.load(sys.stdin);print(next((t['entityPath'] for p in d['projects'] for t in p['tasks'] if t.get('source')=='entity' and t.get('entityPath')),''))")
if [ -n "$ENT_PROBE" ]; then
  RESP=$(curl -s -XPOST $BASE/api/tasks/field-edit -H 'content-type: application/json' -d "{\"entityPath\":\"$ENT_PROBE\",\"field\":\"priority\",\"value\":\"critical\"}")
  echo "$RESP" | grep -q "not editable" && pass "field-edit rejects priority" || fail "field-edit allows priority: $RESP"
  RESP=$(curl -s -XPOST $BASE/api/tasks/field-edit -H 'content-type: application/json' -d "{\"entityPath\":\"$ENT_PROBE\",\"field\":\"constructor\",\"value\":\"x\"}")
  echo "$RESP" | grep -q "not editable" && pass "field-edit rejects constructor" || fail "constructor: $RESP"
  RESP=$(curl -s -XPOST $BASE/api/tasks/field-edit -H 'content-type: application/json' -d "{\"entityPath\":\"$ENT_PROBE\",\"field\":\"status\",\"value\":\"done\"}")
  echo "$RESP" | grep -q "use /api/tasks/status-edit" && pass "field-edit redirects status" || fail "status redirect: $RESP"
else
  fail "no entity task found to probe field-edit allowlist"
fi

# ── CRUD endpoints: happy path ─────────────────────────────────
echo "=== CRUD ==="
# toggle — flip + revert
curl -s -XPOST $BASE/api/tasks/toggle -H 'content-type: application/json' -d "{\"tasksPath\":\"1-Projects/$TEST_PROJECT_SLUG/tasks.md\",\"line\":$TEST_INLINE_LINE,\"done\":true}" | grep -q '"ok":true' && pass "toggle done" || fail "toggle"
curl -s -XPOST $BASE/api/tasks/toggle -H 'content-type: application/json' -d "{\"tasksPath\":\"1-Projects/$TEST_PROJECT_SLUG/tasks.md\",\"line\":$TEST_INLINE_LINE,\"done\":false}" >/dev/null
# tri-state cycle
curl -s -XPOST $BASE/api/tasks/toggle -H 'content-type: application/json' -d "{\"tasksPath\":\"1-Projects/$TEST_PROJECT_SLUG/tasks.md\",\"line\":$TEST_INLINE_LINE,\"done\":\"next\"}" | grep -q '"newCheckbox"' && pass "toggle tri-state (next)" || fail "toggle tri-state"
curl -s -XPOST $BASE/api/tasks/toggle -H 'content-type: application/json' -d "{\"tasksPath\":\"1-Projects/$TEST_PROJECT_SLUG/tasks.md\",\"line\":$TEST_INLINE_LINE,\"done\":false}" >/dev/null
# add
RESP=$(curl -s -XPOST $BASE/api/tasks/add -H 'content-type: application/json' -d "{\"slug\":\"$TEST_PROJECT_SLUG\",\"text\":\"verify-full-sweep test task\"}")
echo "$RESP" | grep -q '"ok":true' && pass "add task" || fail "add: $RESP"
LINE=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('line',0))")
# edit
curl -s -XPOST $BASE/api/tasks/edit -H 'content-type: application/json' -d "{\"tasksPath\":\"1-Projects/$TEST_PROJECT_SLUG/tasks.md\",\"line\":$LINE,\"newText\":\"verify-full-sweep edited\"}" | grep -q '"ok":true' && pass "edit task" || fail "edit"
# remove artifact via sed (use proper OS-aware flags)
sed -i.bak '/verify-full-sweep/d' "$TEST_TASKS_MD" && rm -f "${TEST_TASKS_MD}.bak"
grep -c "verify-full-sweep" "$TEST_TASKS_MD" | grep -q '^0$' && pass "cleanup add/edit artifact" || fail "cleanup"

# create-entity + delete
RESP=$(curl -s -XPOST $BASE/api/tasks/create-entity -H 'content-type: application/json' -d "{\"slug\":\"$TEST_PROJECT_SLUG\",\"action\":\"verify-sweep entity test\",\"impact\":\"medium\",\"urgency\":\"low\"}")
echo "$RESP" | grep -q '"ok":true' && pass "create-entity" || fail "create-entity: $RESP"
ENT_PATH=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('entityPath',''))")
[ -n "$ENT_PATH" ] && [ -f "$VAULT_ROOT/$ENT_PATH" ] && pass "entity file on disk" || fail "no entity file: $ENT_PATH"
# field-edit on that entity
curl -s -XPOST $BASE/api/tasks/field-edit -H 'content-type: application/json' -d "{\"entityPath\":\"$ENT_PATH\",\"field\":\"impact\",\"value\":\"high\"}" | grep -q '"ok":true' && pass "field-edit on entity" || fail "field-edit failed"
grep -q "^impact: high" "$VAULT_ROOT/$ENT_PATH" && pass "impact persisted on disk" || fail "impact not persisted"
# status-edit → done (reconcileFired may be true or false depending on RECONCILE_SCRIPT_PATH env var)
RESP=$(curl -s -XPOST $BASE/api/tasks/status-edit -H 'content-type: application/json' -d "{\"entityPath\":\"$ENT_PATH\",\"status\":\"done\"}")
echo "$RESP" | grep -q '"ok":true' && pass "status-edit to done" || fail "status-edit: $RESP"
# Cleanup
rm "$VAULT_ROOT/$ENT_PATH"
[ ! -f "$VAULT_ROOT/$ENT_PATH" ] && pass "entity cleaned up" || fail "cleanup failed"

# project-field-edit → driver
curl -s -XPOST $BASE/api/projects/field-edit -H 'content-type: application/json' -d "{\"slug\":\"$TEST_PROJECT_SLUG\",\"field\":\"driver\",\"value\":\"agent\"}" | grep -q '"ok":true' && pass "project-field-edit" || fail "project field-edit"
# revert
curl -s -XPOST $BASE/api/projects/field-edit -H 'content-type: application/json' -d "{\"slug\":\"$TEST_PROJECT_SLUG\",\"field\":\"driver\",\"value\":\"collaborative\"}" >/dev/null

# promote-and-edit — simulate inline promote
curl -s -XPOST $BASE/api/tasks/add -H 'content-type: application/json' -d "{\"slug\":\"$TEST_PROJECT_SLUG\",\"text\":\"verify-sweep promote test\"}" >/dev/null
LINE=$(grep -n "verify-sweep promote test" "$TEST_TASKS_MD" | head -1 | cut -d: -f1)
RESP=$(curl -s -XPOST $BASE/api/tasks/promote-and-edit -H 'content-type: application/json' -d "{\"tasksPath\":\"1-Projects/$TEST_PROJECT_SLUG/tasks.md\",\"line\":$LINE,\"field\":\"impact\",\"value\":\"medium\"}")
ENT=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('entityPath',''))")
echo "$RESP" | grep -q '"ok":true' && pass "promote-and-edit" || fail "promote-and-edit: $RESP"
grep -q "verify-sweep promote test" "$TEST_TASKS_MD" || pass "inline line removed after promote"
grep -q "^impact: medium" "$VAULT_ROOT/$ENT" && pass "promote-and-edit wrote impact" || fail "impact not written"
rm -f "$VAULT_ROOT/$ENT"

# ── 50-parallel toggle regression ─────────────────────────────
echo "=== 50-parallel toggle ==="
SUCCESS=$(seq 50 | xargs -P 50 -I {} curl -s -m 10 -XPOST $BASE/api/tasks/toggle -H 'content-type: application/json' -d "{\"tasksPath\":\"1-Projects/$TEST_PROJECT_SLUG/tasks.md\",\"line\":$TEST_INLINE_LINE,\"done\":true}" -w "%{http_code}\n" -o /dev/null 2>/dev/null | grep -c "^200$")
[ "$SUCCESS" -eq 50 ] && pass "50/50 parallel toggles" || fail "parallel: $SUCCESS/50"
curl -s -XPOST $BASE/api/tasks/toggle -H 'content-type: application/json' -d "{\"tasksPath\":\"1-Projects/$TEST_PROJECT_SLUG/tasks.md\",\"line\":$TEST_INLINE_LINE,\"done\":false}" >/dev/null

# ── Symlink bypass ─────────────────────────────────────────
SYMLINK_TGT="$VAULT_ROOT/1-Projects/$TEST_PROJECT_SLUG/tasks/verify-symlink"
mkdir -p "$(dirname "$SYMLINK_TGT")" 2>/dev/null
ln -sf /etc/passwd "$SYMLINK_TGT" 2>/dev/null
CODE=$(curl -s -o /dev/null -w "%{http_code}" -XPOST $BASE/api/tasks/field-edit -H 'content-type: application/json' -d "{\"entityPath\":\"1-Projects/$TEST_PROJECT_SLUG/tasks/verify-symlink\",\"field\":\"impact\",\"value\":\"high\"}")
[ "$CODE" = "403" ] && pass "symlink to /etc/passwd blocked (403)" || fail "symlink $CODE"
rm -f "$SYMLINK_TGT"

# ── TOCTOU regression ─────────────────────────────────────
SUCCESS=$(seq 20 | xargs -P 20 -I {} curl -s -m 5 -XPOST $BASE/api/tasks/create-entity -H 'content-type: application/json' -d "{\"slug\":\"$TEST_PROJECT_SLUG\",\"action\":\"toctou-verify test\"}" -w "%{http_code}\n" -o /dev/null 2>/dev/null | grep -c "^201$")
[ "$SUCCESS" -eq 1 ] && pass "TOCTOU: 1×201 (others 409)" || fail "TOCTOU: $SUCCESS 201s"
rm -f "$VAULT_ROOT/1-Projects/$TEST_PROJECT_SLUG/tasks/toctou-verify-test.md"

# ── AI tells grep ─────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
N=$(grep -rn "⚙\|⏎\|›\|○\|●" src/ 2>/dev/null | wc -l | tr -d ' ')
[ "$N" = "0" ] && pass "no Unicode pseudo-icons" || fail "$N Unicode icons"
N=$(grep -rn "font-bold" src/ 2>/dev/null | wc -l | tr -d ' ')
[ "$N" = "0" ] && pass "no font-bold" || fail "$N font-bold"
N=$(grep -rn "as any" src/ 2>/dev/null | wc -l | tr -d ' ')
[ "$N" = "0" ] && pass "no 'as any'" || fail "$N as any"
N=$(grep -rn "console\.\(log\|warn\|debug\)" src/ 2>/dev/null | wc -l | tr -d ' ')
[ "$N" = "0" ] && pass "no console.log/warn/debug" || fail "$N console.*"
N=$(grep -rn "task\.text" src/ 2>/dev/null | wc -l | tr -d ' ')
[ "$N" = "0" ] && pass "no task.text (all task.action)" || fail "$N task.text residue"

# ── Print results ─────────────────────────────────
echo
echo "═══════════════════════════════════════"
printf '%s\n' "${RESULTS[@]}"
echo "═══════════════════════════════════════"
TOTAL=${#RESULTS[@]}
PASSED=$(printf '%s\n' "${RESULTS[@]}" | grep -c "^✅")
FAILED=$(printf '%s\n' "${RESULTS[@]}" | grep -c "^❌")
echo "TOTAL: $PASSED / $TOTAL passed, $FAILED failed"
