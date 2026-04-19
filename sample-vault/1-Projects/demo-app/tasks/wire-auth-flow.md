---
created: 2026-04-05
created-by: human
tags:
  - type/task
action: Wire OAuth flow end-to-end (Google + GitHub providers)
status: in-progress
due: 2026-04-15
impact: high
urgency: high
parent-project: "[[1-Projects/demo-app/README]]"
---

# Wire auth flow

Backend endpoint is ready (`POST /api/auth/callback`). Needs the frontend redirect + session-cookie handling. Check the reference doc Fernando linked for cookie SameSite settings.

## Blockers

Waiting on the GitHub OAuth app registration — ticket with IT opened.

[[3-Resources/anchors/status-in-progress]]
