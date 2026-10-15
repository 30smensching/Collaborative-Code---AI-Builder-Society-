# Ripple Effect Mapper

Type in a real-world event, such as *"What happens if the US imposes a 25% tariff on imported semiconductors?"*, and Claude maps the chain reaction across industries, companies and countries.

There are two versions:

- **Web version (main):** `web/ripple-effect-mapper.html`, published at https://claude.ai/artifact/PECKbVPSsVgQPCEdXzi3Lc. It runs on each viewer's own Claude account, so it needs no API key.
- **Local version:** a Flask app (`app.py`) that calls the Claude API with your own API key. It has the mapper only.

## What the web version does

- **Map an event.** An interactive cause-and-effect graph from the event to direct, second-order and third-order effects, plus a step-by-step version of the chain. Tabs show winners & losers, best/likely/worst scenarios, country impacts, and **solutions** (realistic responses, their trade-offs, and a button to map the ripple effects of each solution).
- **Daily briefing.** Five things moving the global economy today and why they matter to students, plus a number, fact and concept of the day and dates to watch.
- **Global events.** Nine current stories, each with a "what if" question you can map in one click.
- **Study.** Students read a scenario and predict what happens, by multiple choice (checked instantly) or a written answer (graded by Claude with feedback and a model answer). A score is kept in the browser.
- **Account (top right).** Who's viewing, whether Claude is connected, theme and study preferences, and data saved in the browser.

The Daily briefing and Global events tabs are refreshed every morning by a scheduled Claude routine. See `ops/morning-news-refresh.md`.

## Running the local version

You need Python 3.10+ and an Anthropic API key.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then paste your key into .env
python app.py
```

Then open http://localhost:5050.

## Notes

- Each analysis is one Claude call and takes about a minute.
- Analyses come from the model's knowledge. The web version passes recent background from the news tabs into the analysis, but very recent events may still be missing.
