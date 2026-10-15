const EXAMPLES = [
  "the US imposes a 25% tariff on imported semiconductors",
  "China restricts exports of rare earth minerals",
  "OPEC+ cuts oil production by 2 million barrels per day",
  "a drought cuts Brazil's coffee harvest by 30%",
  "the European Central Bank raises interest rates by 1 percentage point",
  "the Strait of Hormuz is closed to shipping for a month",
];

const LOADING_MESSAGES = [
  "Tracing the chain reaction…",
  "Following the money through supply chains…",
  "Checking which industries are exposed…",
  "Weighing how trading partners might respond…",
  "Sorting winners from losers…",
  "Sketching best and worst cases…",
];

const STEP_NAMES = ["The event", "Direct effects", "Second-order effects", "Third-order effects"];
const TIMEFRAMES = {
  immediate: "Immediate",
  short_term: "Weeks to months",
  medium_term: "1–2 years",
  long_term: "Long term",
};
const MAX_FOCUS = 8;
const HISTORY_KEY = "ripple-history";

const $ = (id) => document.getElementById(id);

let focusCountries = [];
let cy = null;
let current = null;

// ---------- small DOM helpers ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function tag(text, kind = "") {
  return el("span", { class: `tag ${kind}` }, text);
}

function list(items) {
  return el("ul", {}, items.map((item) => el("li", {}, item)));
}

function pretty(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).replace(/_/g, " ");
}

// ---------- form: examples and country chips ----------

function setupForm() {
  for (const example of EXAMPLES) {
    $("examples").append(
      el("button", { type: "button", onclick: () => { $("event").value = example; $("event").focus(); } }, example)
    );
  }
  for (const name of COUNTRIES) $("country-list").append(el("option", { value: name }));

  $("country-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addFocusCountry(e.target.value);
    }
  });
  // Picking an option from the datalist fires "change" without a keypress.
  $("country-input").addEventListener("change", (e) => {
    if (COUNTRIES.includes(e.target.value)) addFocusCountry(e.target.value);
  });

  $("ask-form").addEventListener("submit", (e) => {
    e.preventDefault();
    addFocusCountry($("country-input").value);
    runAnalysis($("event").value.trim(), [...focusCountries]);
  });
}

function addFocusCountry(raw) {
  const name = raw.trim();
  $("country-input").value = "";
  if (!name || focusCountries.length >= MAX_FOCUS) return;
  if (focusCountries.some((c) => c.toLowerCase() === name.toLowerCase())) return;
  focusCountries.push(name);
  renderChips();
}

function renderChips() {
  $("country-chips").replaceChildren(
    ...focusCountries.map((name) =>
      el("span", { class: "chip" }, name,
        el("button", {
          type: "button",
          "aria-label": `Remove ${name}`,
          onclick: () => { focusCountries = focusCountries.filter((c) => c !== name); renderChips(); },
        }, "×"))
    )
  );
}

// ---------- calling the API ----------

async function runAnalysis(event, focus) {
  if (!event) return;
  $("error").hidden = true;
  $("results").hidden = true;
  $("loading").hidden = false;
  $("submit").disabled = true;

  const started = Date.now();
  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    $("elapsed").textContent = Math.round((Date.now() - started) / 1000);
    if (tick % 6 === 0) $("loading-text").textContent = LOADING_MESSAGES[(tick / 6) % LOADING_MESSAGES.length];
  }, 1000);

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, focus_countries: focus }),
    });
    const data = await response.json().catch(() => ({ error: "The server returned an unreadable response." }));
    if (!response.ok || data.error) throw new Error(data.error || `Request failed (${response.status}).`);
    saveHistory({ event, focus, analysis: data, at: Date.now() });
    showResults(data);
  } catch (err) {
    $("error").textContent = err.message;
    $("error").hidden = false;
  } finally {
    clearInterval(timer);
    $("loading").hidden = true;
    $("loading-text").textContent = LOADING_MESSAGES[0];
    $("elapsed").textContent = "0";
    $("submit").disabled = false;
  }
}

// ---------- history (per-browser convenience only) ----------

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveHistory(entry) {
  const items = [entry, ...loadHistory().filter((h) => h.event !== entry.event || h.focus.join() !== entry.focus.join())].slice(0, 8);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {
    // Storage full or blocked; history is optional.
  }
  renderHistory();
}

function renderHistory() {
  const items = loadHistory();
  $("history-box").hidden = items.length === 0;
  $("history").replaceChildren(
    ...items.map((item) =>
      el("li", {},
        el("a", {
          onclick: () => {
            $("event").value = item.event;
            focusCountries = [...item.focus];
            renderChips();
            showResults(item.analysis);
          },
        }, item.analysis.title || item.event),
        item.focus.length ? el("span", { class: "hint" }, ` — ${item.focus.join(", ")}`) : null)
    )
  );
}

// ---------- results ----------

function showResults(analysis) {
  current = analysis;
  $("r-title").textContent = analysis.title;
  $("r-summary").textContent = analysis.summary;
  $("r-assumptions").replaceChildren(...analysis.assumptions.map((a) => el("li", {}, a)));

  renderChainSteps(analysis);
  renderPlayers(analysis);
  renderScenarios(analysis);
  renderCountries(analysis);

  $("results").hidden = false;
  selectTab("graph");
  renderGraph(analysis);
  $("results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function nodeById(id) {
  return current.nodes.find((n) => n.id === id);
}

function renderChainSteps(analysis) {
  const byOrder = new Map();
  for (const node of analysis.nodes) {
    const order = Math.max(0, node.order);
    if (!byOrder.has(order)) byOrder.set(order, []);
    byOrder.get(order).push(node);
  }
  const orders = [...byOrder.keys()].sort((a, b) => a - b);

  $("chain-steps").replaceChildren(
    ...orders.map((order) =>
      el("li", {},
        el("div", { class: "step-title" }, STEP_NAMES[order] || `${order}th-order effects`),
        el("ul", {}, byOrder.get(order).map((node) => {
          const causes = analysis.edges.filter((e) => e.target === node.id);
          return el("li", {},
            el("strong", {}, node.label), ` (${node.country}) — ${node.description}`,
            causes.length
              ? el("div", { class: "hint" }, "Because: " + causes.map((c) => c.mechanism).join(" "))
              : null);
        })))
    )
  );
}

function renderPlayers(analysis) {
  const render = (people) =>
    people.map((p) =>
      el("li", {},
        el("div", { class: "name" }, p.name),
        el("div", { class: "tags" }, tag(pretty(p.category)), tag(p.country)),
        el("p", {}, p.reason)));
  $("winners").replaceChildren(...render(analysis.winners));
  $("losers").replaceChildren(...render(analysis.losers));
}

function renderScenarios(analysis) {
  const kinds = [["best", "Best case"], ["base", "Most likely"], ["worst", "Worst case"]];
  $("scenarios").replaceChildren(
    ...kinds.map(([key, name]) => {
      const s = analysis.scenarios[key];
      return el("div", { class: `card scenario ${key}` },
        el("div", { class: "kind" }, name),
        el("h3", {}, s.headline),
        el("p", {}, s.narrative),
        el("div", { class: "sub hint" }, "What it looks like"),
        list(s.key_developments),
        el("div", { class: "sub hint" }, "What would push things this way"),
        list(s.triggers));
    })
  );
  $("signposts").replaceChildren(...analysis.signposts.map((s) => el("li", {}, s)));
}

function renderCountries(analysis) {
  $("countries").replaceChildren(
    ...analysis.country_impacts.map((c) => {
      const inGraph = analysis.nodes.some((n) => n.country === c.country);
      return el("div", { class: "card country-card" },
        el("h3", {}, c.country),
        el("div", { class: "tags" }, tag(pretty(c.net_effect), c.net_effect)),
        el("p", {}, c.summary),
        c.key_exposures.length ? list(c.key_exposures) : null,
        el("div", { class: "actions" },
          inGraph
            ? el("button", { type: "button", onclick: () => { $("country-filter").value = c.country; applyFilters(); selectTab("graph"); } }, "Show in graph")
            : null,
          el("button", {
            type: "button",
            onclick: () => {
              addFocusCountry(c.country);
              window.scrollTo({ top: 0, behavior: "smooth" });
              runAnalysis($("event").value.trim(), [...focusCountries]);
            },
          }, `Re-run focused on ${c.country}`)));
    })
  );
}

// ---------- tabs ----------

function selectTab(name) {
  for (const button of document.querySelectorAll("[role=tab]")) {
    button.setAttribute("aria-selected", String(button.dataset.tab === name));
  }
  for (const panel of document.querySelectorAll(".tab-panel")) {
    panel.hidden = panel.dataset.panel !== name;
  }
  // Cytoscape can't measure a hidden container, so refit when the graph tab reappears.
  if (name === "graph" && cy) {
    cy.resize();
    cy.fit(cy.elements(":visible"), 30);
  }
}

// ---------- graph ----------

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function renderGraph(analysis) {
  const colors = {
    text: cssVar("--text"),
    muted: cssVar("--muted"),
    accent: cssVar("--accent"),
    accentText: cssVar("--accent-text"),
  };
  for (const impact of ["positive", "negative", "mixed", "uncertain"]) {
    colors[impact] = cssVar(`--${impact}`);
    colors[`${impact}Bg`] = cssVar(`--${impact}-bg`);
  }
  const width = { low: 140, medium: 165, high: 195 };
  const border = { low: 1.5, medium: 2.5, high: 4 };

  const elements = [
    ...analysis.nodes.map((n) => ({
      data: {
        ...n,
        display: n.category === "event" ? n.label : `${n.label}\n${pretty(n.category)} · ${n.country}`,
        w: n.category === "event" ? 210 : width[n.magnitude],
        bw: border[n.magnitude],
      },
    })),
    ...analysis.edges.map((e, i) => ({ data: { ...e, id: `e${i}` } })),
  ];

  if (cy) cy.destroy();
  cy = cytoscape({
    container: $("cy"),
    elements,
    wheelSensitivity: 0.3,
    minZoom: 0.2,
    maxZoom: 2.5,
    style: [
      {
        selector: "node",
        style: {
          shape: "round-rectangle",
          label: "data(display)",
          width: "data(w)",
          height: 58,
          "text-wrap": "wrap",
          "text-max-width": (n) => n.data("w") - 16,
          "text-valign": "center",
          "font-size": 11,
          color: colors.text,
          "background-color": (n) => colors[`${n.data("impact")}Bg`],
          "border-color": (n) => colors[n.data("impact")],
          "border-width": "data(bw)",
        },
      },
      {
        selector: 'node[category = "event"]',
        style: {
          "background-color": colors.accent,
          "border-color": colors.accent,
          color: colors.accentText,
          "font-size": 13,
          "font-weight": "bold",
          height: 70,
        },
      },
      {
        selector: "edge",
        style: {
          width: 1.6,
          "curve-style": "bezier",
          "line-color": colors.muted,
          "target-arrow-color": colors.muted,
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.9,
          "line-style": (e) => ({ likely: "solid", possible: "dashed", speculative: "dotted" })[e.data("likelihood")],
        },
      },
      { selector: ".faded", style: { opacity: 0.15 } },
      { selector: "edge.lit", style: { "line-color": colors.accent, "target-arrow-color": colors.accent, width: 2.6 } },
      { selector: "node.picked", style: { "border-color": colors.accent, "border-width": 5 } },
    ],
    layout: { name: "dagre", rankDir: "LR", nodeSep: 18, rankSep: 70, edgeSep: 10 },
  });

  cy.on("tap", "node", (evt) => selectNode(evt.target.id()));
  cy.on("tap", (evt) => {
    if (evt.target === cy) applyFilters();
  });

  const countries = [...new Set(analysis.nodes.map((n) => n.country))].sort();
  $("country-filter").replaceChildren(
    el("option", { value: "" }, "All countries"),
    ...countries.map((c) => el("option", { value: c }, c))
  );
  $("order-filter").value = "99";
  clearSelection();
}

function applyFilters() {
  if (!cy) return;
  const country = $("country-filter").value;
  const maxOrder = Number($("order-filter").value);

  cy.batch(() => {
    cy.elements().removeClass("faded lit picked");
    cy.nodes().forEach((n) => n.style("display", n.data("order") <= maxOrder ? "element" : "none"));
    if (country) {
      cy.nodes().forEach((n) => {
        if (n.data("country") !== country && n.data("category") !== "event") n.addClass("faded");
      });
      cy.edges().forEach((e) => {
        if (e.source().hasClass("faded") || e.target().hasClass("faded")) e.addClass("faded");
      });
    }
  });
  cy.fit(cy.elements(":visible"), 30);
  $("detail").replaceChildren(el("p", { class: "hint" }, "Click a box to see what causes it and what it leads to. Its downstream chain is highlighted."));
}

function clearSelection() {
  $("country-filter").value = "";
  applyFilters();
}

function selectNode(id) {
  const node = cy.getElementById(id);
  const chain = node.union(node.successors()).union(node.predecessors());

  cy.batch(() => {
    cy.elements().removeClass("faded lit picked");
    cy.elements().not(chain).addClass("faded");
    node.successors("edge").addClass("lit");
    node.addClass("picked");
  });

  const data = nodeById(id);
  const causes = current.edges.filter((e) => e.target === id);
  const effects = current.edges.filter((e) => e.source === id);
  const link = (otherId, mechanism) =>
    el("li", {},
      el("a", { onclick: () => selectNode(otherId) }, nodeById(otherId).label),
      el("div", { class: "hint" }, mechanism));

  $("detail").replaceChildren(
    el("h4", {}, data.label),
    el("div", { class: "tags" },
      tag(pretty(data.impact), data.impact),
      tag(`${pretty(data.magnitude)} impact`),
      tag(TIMEFRAMES[data.timeframe]),
      tag(pretty(data.category)),
      tag(data.country)),
    el("p", {}, data.description),
    causes.length ? el("div", { class: "sub" }, "Caused by") : null,
    causes.length ? el("ul", {}, causes.map((e) => link(e.source, e.mechanism))) : null,
    effects.length ? el("div", { class: "sub" }, "Leads to") : null,
    effects.length ? el("ul", {}, effects.map((e) => link(e.target, e.mechanism))) : null
  );
}

// ---------- boot ----------

cytoscape.use(cytoscapeDagre);
setupForm();
renderHistory();
for (const button of document.querySelectorAll("[role=tab]")) {
  button.addEventListener("click", () => selectTab(button.dataset.tab));
}
$("country-filter").addEventListener("change", applyFilters);
$("order-filter").addEventListener("change", applyFilters);
$("fit").addEventListener("click", clearSelection);
