# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ripple Effect Mapper: users describe a real-world event and Claude maps its chain reaction across industries, companies and countries (cause-and-effect graph, winners/losers, scenarios, country impacts, solutions). Built for university students, with a daily news briefing and a study tool.

Two implementations share the same analysis design:
- `web/ripple-effect-mapper.html` — the main product: a single-file claude.ai artifact published at https://claude.ai/artifact/PECKbVPSsVgQPCEdXzi3Lc.
- `app.py` + `ripple/` + `static/` — an older local Flask version (mapper only) that calls the Claude API with an API key.

## Commands

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # local version setup
.venv/bin/python app.py                                              # run at http://localhost:5050
```

The local version reads `ANTHROPIC_API_KEY` from `.env`. Port 5050 is deliberate (macOS AirPlay takes 5000). There is no test suite or linter.

The web version has no build step. To change it, edit `web/ripple-effect-mapper.html` and republish it with the Artifact tool to the URL above (pass `url`), keeping the declared capabilities: `{"sample": {}, "db": {"rules": [{"path": "", "read": "view", "write": "owner"}]}, "user": {"scopes": ["profile"]}}`. The file is written without `<html>/<head>/<body>` because the publisher wraps it, so to preview it locally wrap it in a doctype/body first.

## Architecture (web version)

- **Claude calls go through the artifact `sample` capability**, which runs on the viewer's own Claude account. There is no API key or server. `buildPrompt()` (analysis), `studyPrompt()` and `gradePrompt()` describe the JSON they want in the prompt, and `normalize()` / `normalizeQuestion()` defensively coerce whatever comes back (enums, missing fields, dangling edges) before rendering. Keep prompt fields and normalizers in sync.
- **News and briefing data have two sources.** The embedded `NEWS` and `BRIEFING` objects are the fallback. At load, `subscribeFeed()` reads the `db` document `feed/latest` and, if `readFeed()` accepts it, replaces them and re-renders. A scheduled cloud routine rewrites `feed/latest` each morning (see `ops/morning-news-refresh.md`; its schema must match `readFeed()`). Only the owner can write the db.
- **Recent-events context.** Each news story carries a `context` paragraph that is passed into the analysis prompt as background, because the model's knowledge predates current events. `setQuestion()`/`contextFor()` drop the context once the user edits the question text.
- **Pages and tabs.** Site-level pages (`showPage`: mapper, briefing, events, study) sit under a full-screen hero and a sticky nav. Results have their own tabs (`selectTab`). Cytoscape cannot measure hidden containers, so `showPage`/`selectTab` call `cy.resize()` and `fitReadable()` when the graph becomes visible.
- **Per-viewer state** (study score, recent analyses, preferences) lives in `localStorage`, always wrapped in try/catch.
- **Styling.** Colors are CSS tokens on `:root` with dark-mode overrides; `graphStyle()` reads them at render time and a MutationObserver on `data-theme` recolors the graph.

## Architecture (local version)

`POST /api/analyze` in `app.py` calls `analyze_event` in `ripple/analyzer.py`, which uses structured outputs (`ANALYSIS_SCHEMA`) with `claude-opus-5-5`, streaming, and `fallbacks="default"`. `static/app.js` reads the schema's field names directly. It predates the web version's solutions, study and news features.
