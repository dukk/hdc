# Automation: HDC Research weekly

**Role:** hdc-research  
**Trigger:** Scripted dispatcher weekly (~7d)  
**Runtime:** hdc-agent-server

## Scripted (no LLM)

- **Queued topics first:** if any `operations/research/topics/*.md` has `status: queued`, invoke LLM (even when today's weekly brief exists).
- Weekly gate (no queued topics): skip if `operations/reports/research-<YYYY-MM-DD>.md` already exists for today.

## LLM

Process queued topics (ad-hoc reports + index update), else write weekly research brief; enqueue low-priority Manager tasks for adopt candidates.

Suggestion channels: `operations/research/suggestions.md`, hdc-web-server Research tab, email `Research: <title>` to manager mailbox.
