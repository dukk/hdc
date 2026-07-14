# Automation: HDC Research weekly

**Role:** hdc-research  
**Trigger:** Scripted dispatcher weekly (~7d)  
**Runtime:** hdc-agent-server

## Scripted (no LLM)

- Weekly gate: skip if `operations/reports/research-<YYYY-MM-DD>.md` already exists for the current ISO week / today.

## LLM

Write research brief; enqueue low-priority Manager tasks for adopt candidates.
