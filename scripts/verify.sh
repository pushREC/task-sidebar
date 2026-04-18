#!/bin/bash
# Comprehensive verification — every endpoint, every feature, every regression
set +e
BASE=http://127.0.0.1:5174
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
PRIORITY_COUNT=$(echo "$VAULT" | python3 -c "import json,sys;d=json.load(sys.stdin);print(sum(1 for p in d['projects'] for t in p['tasks'] if t.get('priority')))")
INFERRED_PROJ=$(echo "$VAULT" | python3 -c "import json,sys;d=json.load(sys.stdin);print(sum(1 for p in d['projects'] if 'progress' in p))")
GOAL_BONUS=$(echo "$VAULT" | python3 -c "import json,sys;d=json.load(sys.stdin);print(sum(1 for p in d['projects'] for t in p['tasks'] if t.get('priority') and t['priority']['breakdown'].get('goal_alignment',0)>0))")
ABS_PATHS=$(echo "$VAULT" | grep -c "/Users/robertzinke")

[ "$PROJ_COUNT" -gt 30 ] && pass "projects indexed: $PROJ_COUNT" || fail "too few projects: $PROJ_COUNT"
[ "$TASK_COUNT" -gt 100 ] && pass "tasks total: $TASK_COUNT" || fail "too few tasks: $TASK_COUNT"
[ "$ENTITY_COUNT" -gt 20 ] && pass "entity tasks: $ENTITY_COUNT" || fail "entity tasks low: $ENTITY_COUNT"
[ "$PRIORITY_COUNT" -gt 20 ] && pass "priorities computed: $PRIORITY_COUNT" || fail "priority compute low: $PRIORITY_COUNT"
[ "$INFERRED_PROJ" -gt 30 ] && pass "projects w/ inferred counts: $INFERRED_PROJ" || fail "inferred fields missing"
[ "$GOAL_BONUS" -gt 0 ] && pass "parent-goal bonus applied: $GOAL_BONUS tasks" || fail "goal bonus not applied"
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
RESP=$(curl -s -XPOST $BASE/api/tasks/field-edit -H 'content-type: application/json' -d '{"entityPath":"1-Projects/e2e-test-project/tasks/task-open.md","field":"priority","value":"critical"}')
echo "$RESP" | grep -q "not editable" && pass "field-edit rejects priority" || fail "field-edit allows priority: $RESP"
RESP=$(curl -s -XPOST $BASE/api/tasks/field-edit -H 'content-type: application/json' -d '{"entityPath":"1-Projects/e2e-test-project/tasks/task-open.md","field":"constructor","value":"x"}')
echo "$RESP" | grep -q "not editable" && pass "field-edit rejects constructor" || fail "constructor: $RESP"
RESP=$(curl -s -XPOST $BASE/api/tasks/field-edit -H 'content-type: application/json' -d '{"entityPath":"1-Projects/e2e-test-project/tasks/task-open.md","field":"status","value":"done"}')
echo "$RESP" | grep -q "use /api/tasks/status-edit" && pass "field-edit redirects status" || fail "status redirect: $RESP"

# ── CRUD endpoints: happy path ─────────────────────────────────
echo "=== CRUD ==="
# toggle — flip line 15 of vault-sidebar tasks.md then revert
curl -s -XPOST $BASE/api/tasks/toggle -H 'content-type: application/json' -d '{"tasksPath":"1-Projects/vault-sidebar/tasks.md","line":15,"done":true}' | grep -q '"ok":true' && pass "toggle done" || fail "toggle"
curl -s -XPOST $BASE/api/tasks/toggle -H 'content-type: application/json' -d '{"tasksPath":"1-Projects/vault-sidebar/tasks.md","line":15,"done":false}' >/dev/null
# tri-state cycle
curl -s -XPOST $BASE/api/tasks/toggle -H 'content-type: application/json' -d '{"tasksPath":"1-Projects/vault-sidebar/tasks.md","line":15,"done":"next"}' | grep -q '"newCheckbox"' && pass "toggle tri-state (next)" || fail "toggle tri-state"
curl -s -XPOST $BASE/api/tasks/toggle -H 'content-type: application/json' -d '{"tasksPath":"1-Projects/vault-sidebar/tasks.md","line":15,"done":false}' >/dev/null
# add
RESP=$(curl -s -XPOST $BASE/api/tasks/add -H 'content-type: application/json' -d '{"slug":"vault-sidebar","text":"verify-full-sweep test task"}')
echo "$RESP" | grep -q '"ok":true' && pass "add task" || fail "add: $RESP"
LINE=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('line',0))")
# edit
curl -s -XPOST $BASE/api/tasks/edit -H 'content-type: application/json' -d "{\"tasksPath\":\"1-Projects/vault-sidebar/tasks.md\",\"line\":$LINE,\"newText\":\"verify-full-sweep edited\"}" | grep -q '"ok":true' && pass "edit task" || fail "edit"
# remove via sed (move + edit take too long for cleanup)
sed -i '' '/verify-full-sweep/d' /Users/robertzinke/pushrec-vault/1-Projects/vault-sidebar/tasks.md
grep -c "verify-full-sweep" /Users/robertzinke/pushrec-vault/1-Projects/vault-sidebar/tasks.md | grep -q '^0$' && pass "cleanup add/edit artifact" || fail "cleanup"

# create-entity + delete
RESP=$(curl -s -XPOST $BASE/api/tasks/create-entity -H 'content-type: application/json' -d '{"slug":"vault-sidebar","action":"verify-sweep entity test","impact":"medium","urgency":"low"}')
echo "$RESP" | grep -q '"ok":true' && pass "create-entity" || fail "create-entity: $RESP"
ENT_PATH=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('entityPath',''))")
[ -n "$ENT_PATH" ] && [ -f "/Users/robertzinke/pushrec-vault/$ENT_PATH" ] && pass "entity file on disk" || fail "no entity file: $ENT_PATH"
# field-edit on that entity
curl -s -XPOST $BASE/api/tasks/field-edit -H 'content-type: application/json' -d "{\"entityPath\":\"$ENT_PATH\",\"field\":\"impact\",\"value\":\"high\"}" | grep -q '"ok":true' && pass "field-edit on entity" || fail "field-edit failed"
grep -q "^impact: high" "/Users/robertzinke/pushrec-vault/$ENT_PATH" && pass "impact persisted on disk" || fail "impact not persisted"
# status-edit → done + reconcile
RESP=$(curl -s -XPOST $BASE/api/tasks/status-edit -H 'content-type: application/json' -d "{\"entityPath\":\"$ENT_PATH\",\"status\":\"done\"}")
echo "$RESP" | grep -q '"reconcileFired":true' && pass "status-edit to done + reconcile fired" || fail "reconcile: $RESP"
# Cleanup
rm "/Users/robertzinke/pushrec-vault/$ENT_PATH"
[ ! -f "/Users/robertzinke/pushrec-vault/$ENT_PATH" ] && pass "entity cleaned up" || fail "cleanup failed"

# project-field-edit → driver
curl -s -XPOST $BASE/api/projects/field-edit -H 'content-type: application/json' -d '{"slug":"vault-sidebar","field":"driver","value":"agent"}' | grep -q '"ok":true' && pass "project-field-edit" || fail "project field-edit"
# revert
curl -s -XPOST $BASE/api/projects/field-edit -H 'content-type: application/json' -d '{"slug":"vault-sidebar","field":"driver","value":"collaborative"}' >/dev/null

# promote-and-edit — simulate inline promote
# first, add an inline task, then promote-and-edit, verify file + line gone, clean up
curl -s -XPOST $BASE/api/tasks/add -H 'content-type: application/json' -d '{"slug":"vault-sidebar","text":"verify-sweep promote test"}' >/dev/null
LINE=$(grep -n "verify-sweep promote test" /Users/robertzinke/pushrec-vault/1-Projects/vault-sidebar/tasks.md | head -1 | cut -d: -f1)
RESP=$(curl -s -XPOST $BASE/api/tasks/promote-and-edit -H 'content-type: application/json' -d "{\"tasksPath\":\"1-Projects/vault-sidebar/tasks.md\",\"line\":$LINE,\"field\":\"impact\",\"value\":\"medium\"}")
ENT=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('entityPath',''))")
echo "$RESP" | grep -q '"ok":true' && pass "promote-and-edit" || fail "promote-and-edit: $RESP"
# Inline line removed
grep -q "verify-sweep promote test" /Users/robertzinke/pushrec-vault/1-Projects/vault-sidebar/tasks.md || pass "inline line removed after promote"
# Entity file with impact=medium
grep -q "^impact: medium" "/Users/robertzinke/pushrec-vault/$ENT" && pass "promote-and-edit wrote impact" || fail "impact not written"
# Cleanup
rm -f "/Users/robertzinke/pushrec-vault/$ENT"

# ── 50-parallel toggle regression ─────────────────────────────
echo "=== 50-parallel toggle ==="
SUCCESS=$(seq 50 | xargs -P 50 -I {} curl -s -m 10 -XPOST $BASE/api/tasks/toggle -H 'content-type: application/json' -d '{"tasksPath":"1-Projects/vault-sidebar/tasks.md","line":15,"done":true}' -w "%{http_code}\n" -o /dev/null 2>/dev/null | grep -c "^200$")
[ "$SUCCESS" -eq 50 ] && pass "50/50 parallel toggles" || fail "parallel: $SUCCESS/50"
curl -s -XPOST $BASE/api/tasks/toggle -H 'content-type: application/json' -d '{"tasksPath":"1-Projects/vault-sidebar/tasks.md","line":15,"done":false}' >/dev/null

# ── Symlink bypass ─────────────────────────────────────────
ln -sf /etc/passwd /Users/robertzinke/pushrec-vault/1-Projects/vault-sidebar/tasks/verify-symlink 2>/dev/null
CODE=$(curl -s -o /dev/null -w "%{http_code}" -XPOST $BASE/api/tasks/field-edit -H 'content-type: application/json' -d '{"entityPath":"1-Projects/vault-sidebar/tasks/verify-symlink","field":"impact","value":"high"}')
[ "$CODE" = "403" ] && pass "symlink to /etc/passwd blocked (403)" || fail "symlink $CODE"
rm -f /Users/robertzinke/pushrec-vault/1-Projects/vault-sidebar/tasks/verify-symlink

# ── TOCTOU regression ─────────────────────────────────────
SUCCESS=$(seq 20 | xargs -P 20 -I {} curl -s -m 5 -XPOST $BASE/api/tasks/create-entity -H 'content-type: application/json' -d '{"slug":"vault-sidebar","action":"toctou-verify test"}' -w "%{http_code}\n" -o /dev/null 2>/dev/null | grep -c "^201$")
[ "$SUCCESS" -eq 1 ] && pass "TOCTOU: 1×201 (others 409)" || fail "TOCTOU: $SUCCESS 201s"
rm -f /Users/robertzinke/pushrec-vault/1-Projects/vault-sidebar/tasks/toctou-verify-test.md

# ── AI tells grep ─────────────────────────────────────────
cd /Users/robertzinke/pushrec-vault/codebases/vault-sidebar
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
