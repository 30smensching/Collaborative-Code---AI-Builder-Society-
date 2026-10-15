"""Turns a real-world event into a structured cause-and-effect analysis using Claude."""

import json

import anthropic

MODEL = "claude-opus-5-5"

CATEGORIES = [
    "event",
    "policy",
    "industry",
    "company",
    "country",
    "market",
    "consumers",
    "workers",
    "investors",
    "government",
]

_string = {"type": "string"}
_string_list = {"type": "array", "items": _string}


def _obj(properties: dict) -> dict:
    """Strict JSON-schema object: every property required, no extras."""
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


_stakeholder = _obj(
    {
        "name": _string,
        "category": {"type": "string", "enum": CATEGORIES},
        "country": _string,
        "reason": _string,
    }
)

_scenario = _obj(
    {
        "headline": _string,
        "narrative": _string,
        "key_developments": _string_list,
        "triggers": _string_list,
    }
)

ANALYSIS_SCHEMA = _obj(
    {
        "title": _string,
        "summary": _string,
        "assumptions": _string_list,
        "nodes": {
            "type": "array",
            "items": _obj(
                {
                    "id": _string,
                    "label": _string,
                    "category": {"type": "string", "enum": CATEGORIES},
                    "country": _string,
                    "description": _string,
                    "impact": {
                        "type": "string",
                        "enum": ["positive", "negative", "mixed", "uncertain"],
                    },
                    "magnitude": {"type": "string", "enum": ["low", "medium", "high"]},
                    "timeframe": {
                        "type": "string",
                        "enum": ["immediate", "short_term", "medium_term", "long_term"],
                    },
                    "order": {"type": "integer"},
                }
            ),
        },
        "edges": {
            "type": "array",
            "items": _obj(
                {
                    "source": _string,
                    "target": _string,
                    "mechanism": _string,
                    "likelihood": {
                        "type": "string",
                        "enum": ["likely", "possible", "speculative"],
                    },
                }
            ),
        },
        "winners": {"type": "array", "items": _stakeholder},
        "losers": {"type": "array", "items": _stakeholder},
        "scenarios": _obj({"best": _scenario, "base": _scenario, "worst": _scenario}),
        "country_impacts": {
            "type": "array",
            "items": _obj(
                {
                    "country": _string,
                    "net_effect": {
                        "type": "string",
                        "enum": ["gains", "loses", "mixed", "minimal"],
                    },
                    "summary": _string,
                    "key_exposures": _string_list,
                }
            ),
        },
        "signposts": _string_list,
    }
)

SYSTEM_PROMPT = """You are a geopolitical and macroeconomic analyst. Users describe a real-world \
event, policy, or hypothetical ("What happens if the US imposes a 25% tariff on imported \
semiconductors?"), and you map how its effects ripple across industries, companies, countries, \
and people.

Build a causal graph:
- Exactly one node has category "event", id "event", and order 0: the triggering event itself.
- Every other node is an effect. "order" is how many causal steps it sits from the event \
(1 = direct effect, 2 = effect of a direct effect, and so on). Aim for 15-28 nodes reaching \
order 3 or 4, so the graph shows real chain reactions rather than a flat list.
- Node ids are short snake_case strings. Labels are 2-6 words.
- Use "country" for where the effect lands; use "Global" when it is not specific to one country.
- Each edge points from cause to effect and its "mechanism" says in one sentence how the cause \
produces the effect (e.g. "Higher input costs squeeze manufacturer margins"). Every non-event \
node must be reachable from the event. Feedback loops are allowed when they are real (e.g. \
retaliation).
- Name real companies and industries where the exposure is well established. Do not invent \
precise statistics; when a number helps, give a hedged range and say it is an estimate.
- "impact" is from the perspective of the node itself (a tariff that helps domestic chipmakers \
is "positive" for them).

Then give:
- winners and losers: the stakeholders that gain or lose most, with the reason.
- scenarios: best, base (most likely), and worst case, each with a narrative, the key \
developments that define it, and the triggers that would push events toward it.
- country_impacts: how each relevant country fares. Always include every country the user \
asks to focus on, plus the other most-affected countries.
- signposts: concrete indicators to watch that would show which scenario is unfolding.
- assumptions: what you assumed to make the question answerable (timing, scope, \
enforcement, starting conditions).

Your knowledge has a cutoff and you have no live data, so reason from structure and \
historical precedent, and flag where recent developments could change the picture."""


class AnalysisError(Exception):
    """Raised when Claude cannot produce a usable analysis."""


def _build_user_message(event: str, focus_countries: list[str]) -> str:
    message = f"Event to analyze:\n{event.strip()}"
    if focus_countries:
        message += (
            "\n\nFocus countries (cover each one in country_impacts and include their "
            f"key industries and companies in the graph): {', '.join(focus_countries)}"
        )
    return message


def analyze_event(
    client: anthropic.Anthropic, event: str, focus_countries: list[str]
) -> dict:
    """Ask Claude for a ripple-effect analysis and return it as a dict matching ANALYSIS_SCHEMA."""
    # Streaming keeps a long, high-max_tokens request clear of HTTP timeouts.
    # fallbacks="default" re-runs the request on another model server-side if the
    # primary model's safety classifiers decline it.
    with client.beta.messages.stream(
        model=MODEL,
        max_tokens=32000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={
            "effort": "medium",
            "format": {"type": "json_schema", "schema": ANALYSIS_SCHEMA},
        },
        system=SYSTEM_PROMPT,
        messages=[
            {"role": "user", "content": _build_user_message(event, focus_countries)}
        ],
    ) as stream:
        message = stream.get_final_message()

    if message.stop_reason == "refusal":
        raise AnalysisError("Claude declined to analyze this event. Try rephrasing it.")
    if message.stop_reason == "max_tokens":
        raise AnalysisError("The analysis was too long and got cut off. Try a narrower question.")

    text_blocks = [block.text for block in message.content if block.type == "text"]
    if not text_blocks:
        raise AnalysisError("Claude returned no analysis.")
    try:
        analysis = json.loads(text_blocks[-1])
    except json.JSONDecodeError as exc:
        raise AnalysisError("Claude returned an analysis that could not be read.") from exc

    return _clean_graph(analysis)


def _clean_graph(analysis: dict) -> dict:
    """Drop duplicate nodes and edges that point at missing nodes so the graph always renders."""
    seen, nodes = set(), []
    for node in analysis["nodes"]:
        if node["id"] not in seen:
            seen.add(node["id"])
            nodes.append(node)
    analysis["nodes"] = nodes
    analysis["edges"] = [
        edge
        for edge in analysis["edges"]
        if edge["source"] in seen and edge["target"] in seen and edge["source"] != edge["target"]
    ]
    return analysis
