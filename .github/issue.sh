#!/bin/sh
# Open an issue with this label, or add a comment to the open one: sh .github/issue.sh <label> <title> <body>
# (the weekly workflow's failures; needs GH_TOKEN)
label="$1"; title="$2"; body="$3"
gh label create "$label" --color FBCA04 --description "Found by the weekly run" 2>/dev/null || true
open=$(gh issue list --label "$label" --state open --json number --jq '.[0].number')
if [ -n "$open" ]; then gh issue comment "$open" --body "$body"; else gh issue create --title "$title" --label "$label" --body "$body"; fi
