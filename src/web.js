// Module widget "web": fetches a number from an address on the internet every so often and
// turns it into a control signal between 0 and 1. The weather, a sensor, anything that answers
// with JSON and allows this page to ask.

// Module id -> { timer, text }. It outlives a redraw of the panels.
const feeds = new Map();

export function forgetFeed(id) {
	clearInterval(feeds.get(id)?.timer);
	feeds.delete(id);
}

const FIELDS = [["url", "Adresse"], ["path", "Feld"], ["min", "Wert für 0"], ["max", "Wert für 1"], ["every", "alle (s)"]];

export function web(def, io) {
	const el = document.createElement("div");
	el.className = "web";
	const status = document.createElement("output");
	const feed = feeds.get(io.id) ?? feeds.set(io.id, { timer: null, text: "noch nichts geholt" }).get(io.id);
	status.textContent = feed.text;

	const fetchOnce = async () => {
		const { url, path, min, max } = io.settings();
		try {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			// "current.temperature_2m" walks into the answer one name at a time.
			const raw = Number(path.split(".").filter(Boolean).reduce((value, key) => value?.[key], await res.json()));
			if (!Number.isFinite(raw)) throw new Error(`„${path}“ ist dort keine Zahl`);
			io.poke("value", Math.min(1, Math.max(0, (raw - Number(min)) / (Number(max) - Number(min)))));
			feed.text = `${raw}`;
		} catch (err) {
			feed.text = `Fehler: ${err.message}`;
		}
		for (const out of document.querySelectorAll(`.module[data-id="${io.id}"] .web output`)) out.textContent = feed.text;
	};
	const restart = () => {
		clearInterval(feed.timer);
		feed.timer = setInterval(fetchOnce, Math.max(5, Number(io.settings().every) || 60) * 1000);
		fetchOnce();
	};
	if (!feed.timer) restart();

	for (const [key, label] of FIELDS) {
		const input = Object.assign(document.createElement("input"), { value: io.settings()[key] ?? "" });
		input.setAttribute("aria-label", label);
		input.addEventListener("change", () => {
			io.setSetting(key, input.value.trim());
			restart();
		});
		const row = document.createElement("label");
		row.append(label, input);
		el.append(row);
	}
	el.append(status);
	return el;
}
