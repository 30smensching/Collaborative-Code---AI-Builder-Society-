"""Flask server: serves the web UI and the /api/analyze endpoint."""

import logging

import anthropic
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

from ripple.analyzer import AnalysisError, analyze_event

load_dotenv()

app = Flask(__name__, static_folder="static", static_url_path="/static")
log = logging.getLogger(__name__)

MAX_EVENT_CHARS = 2000
MAX_FOCUS_COUNTRIES = 8

_client = None


def get_client() -> anthropic.Anthropic:
    # Created lazily so the server can start (and show a clear error) without credentials.
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.post("/api/analyze")
def analyze():
    body = request.get_json(silent=True) or {}
    event = str(body.get("event", "")).strip()
    focus = [str(c).strip() for c in body.get("focus_countries", []) if str(c).strip()]

    if not event:
        return jsonify(error="Describe an event to analyze."), 400
    if len(event) > MAX_EVENT_CHARS:
        return jsonify(error=f"Keep the event under {MAX_EVENT_CHARS} characters."), 400
    focus = focus[:MAX_FOCUS_COUNTRIES]

    try:
        return jsonify(analyze_event(get_client(), event, focus))
    except AnalysisError as exc:
        return jsonify(error=str(exc)), 422
    except anthropic.AuthenticationError:
        return jsonify(error="The Anthropic API key is missing or invalid. Check your .env file."), 500
    except anthropic.RateLimitError:
        return jsonify(error="Rate limited by the Anthropic API. Wait a moment and try again."), 429
    except anthropic.APIConnectionError:
        return jsonify(error="Could not reach the Anthropic API. Check your connection."), 502
    except anthropic.APIStatusError as exc:
        log.exception("Anthropic API error")
        return jsonify(error=f"Anthropic API error ({exc.status_code})."), 502
    except anthropic.AnthropicError as exc:
        return jsonify(error=f"Anthropic client error: {exc}"), 500
    except TypeError:
        # The SDK raises TypeError when it finds no API key or login profile.
        log.exception("Analysis failed")
        return jsonify(
            error="No Anthropic credentials found. Add ANTHROPIC_API_KEY to your .env file and restart."
        ), 500


if __name__ == "__main__":
    # Port 5000 is taken by AirPlay Receiver on macOS.
    app.run(debug=True, port=5050)
