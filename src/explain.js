// The explain mode: plain words for whatever is tapped, and a live look at the signal there.
// The texts are for someone who patches for the first time.

const KIND = {
	audio: ["Klang", "Hier fließt der Klang selbst, also das, was du am Ende hörst."],
	cv: ["Steuersignal", "Hier fließt kein Klang, sondern ein Wert, der etwas bewegt. So als würde eine unsichtbare Hand an einem Regler drehen."],
	gate: ["An-Aus-Signal", "Hier fließt nur an oder aus, wie eine gedrückte und wieder losgelassene Taste."],
};

// What happens when a signal arrives at an input. First "modul.Buchse", then the jack's name alone.
const INTO = {
	"adsr.Gate": "An startet die Hüllkurve: Sie schwillt an und fällt auf den Haltewert. Aus lässt sie ausklingen.",
	"vcf.CV": "Das öffnet und schließt das Filter. Mehr Signal lässt mehr Höhen durch.",
	"vca.CV": "Das bestimmt, wie viel Klang durchkommt. Mit einer Hüllkurve bekommt der Ton einen Anfang und ein Ende.",
	"vco.FM": "Das verbiegt die Tonhöhe. Langsam wird daraus ein Vibrato, schnell ein neuer Klang.",
	"output.Mono": "Das geht auf beide Lautsprecher. Das ist, was du hörst.",
	"output.L": "Das geht auf den linken Lautsprecher.",
	"output.R": "Das geht auf den rechten Lautsprecher.",
	"life.Futter": "Mehr Signal lässt mehr Futter wachsen, also mehr Wesen leben.",
	"life.Klima": "Das verschiebt das Klima der Welt. Die Wesen müssen sich anpassen.",
	Clock: "Jeder Impuls schaltet {dst} einen Schritt weiter.",
	Reset: "Ein Impuls stellt {dst} zurück auf den Anfang.",
	"V/Oct": "Das bestimmt die Tonhöhe von {dst}. Plus 1 ist eine Oktave höher.",
	Trig: "Jeder Impuls löst {dst} einmal aus.",
	Gate: "Solange es an ist, ist {dst} aktiv.",
	Side: "Wird es hier laut, macht {dst} den Klang am anderen Eingang leiser.",
	Index: "Mehr Signal macht den Klang heller und metallischer.",
	Pitch: "Das ist die Tonhöhe, die {dst} als Note weitergibt.",
};
const INTO_KIND = { audio: "{dst} bekommt diesen Klang und arbeitet damit weiter.", cv: "Das steuert {dst} von außen.", gate: "Das schaltet {dst}." };

// What comes out of an output.
const OUT = {
	Sinus: "ein weicher, runder Ton", Säge: "ein heller, scharfer Ton", Rechteck: "ein hohler Ton", Dreieck: "eine gleichmäßige Auf-und-ab-Bewegung",
	Env: "ein Verlauf zwischen 0 und 1, die Hüllkurve", Pitch: "eine Tonhöhe", Gate: "an oder aus", Vel: "wie fest die Taste gedrückt wurde", Mod: "die Stellung des Modulationsrads",
	"1/4": "ein Impuls pro Viertelnote", "1/8": "ein Impuls pro Achtelnote", "1/16": "ein Impuls pro Sechzehntelnote",
	Geburt: "ein Impuls bei jeder Geburt", Tod: "ein Impuls bei jedem Tod", Pop: "die Größe der Bevölkerung", Gen: "das mittlere Erbgut der Wesen",
	Stufen: "ein Zufallswert, der bis zum nächsten Impuls stehen bleibt", Weich: "derselbe Zufallswert, geglättet",
};
const OUT_KIND = { audio: "der Klang dieses Moduls", cv: "ein Steuersignal", gate: "ein An-Aus-Signal" };

const KNOB = {
	Cutoff: "Die Grenze des Filters. Alles darüber wird leiser: nach links dumpf, nach rechts hell.",
	Resonanz: "Betont den Bereich um die Grenze des Filters. Viel davon pfeift und singt.",
	"CV-Anteil": "Wie stark das Signal am CV-Eingang das Filter bewegt. Links von der Mitte bewegt es andersherum.",
	Attack: "Wie lange der Ton braucht, um da zu sein. Kurz knallt, lang schwillt an.",
	Decay: "Wie schnell der Ton nach dem Anschwellen abfällt.",
	Sustain: "Wie laut der Ton bleibt, solange die Taste gehalten wird.",
	Release: "Wie lange der Ton nach dem Loslassen ausklingt.",
	Pegel: "Wie laut dieses Modul ist. Beim VCA: wie weit er von sich aus offen steht.",
	Volume: "Die Lautstärke am Ausgang.",
	Limiter: "Ein Gehörschutz: verhindert, dass es zu laut wird.",
	Mix: "Das Verhältnis von unverändertem Klang zu Effekt.",
	Feedback: "Wie viel vom Ergebnis zurück in den Effekt geht. Mehr davon macht ihn länger und stärker.",
	Zeit: "Der Abstand zwischen Klang und Echo.",
	Rate: "Wie schnell die Bewegung läuft.",
	Tiefe: "Wie weit die Bewegung ausschlägt.",
	Oktave: "Verschiebt die Tonhöhe in ganzen Oktaven.",
	Stimmung: "Verschiebt die Tonhöhe in Halbtönen.",
	Fein: "Verstimmt ganz leicht. Zwei leicht verstimmte Oszillatoren klingen breiter.",
	FM: "Wie stark der FM-Eingang die Tonhöhe verbiegt.",
	Tempo: "Die Geschwindigkeit des Takts in Schlägen pro Minute.",
	Gate: "Wie lange jeder Impuls an bleibt. Kurz klingt abgehackt, lang gebunden.",
	Lauf: "Startet und stoppt den Takt.",
	Glide: "Lässt die Tonhöhe von Ton zu Ton gleiten, statt zu springen.",
	Stufen: "Wie viele Schritte gespielt werden, bevor es von vorn beginnt.",
	Schritte: "Wie viele Schritte eine Runde hat.",
	Treffer: "Wie viele Schläge auf die Schritte verteilt werden.",
	Dreh: "Verschiebt das Muster um ganze Schritte.",
	Dauer: "Wie lange der Hall nachklingt.",
	Hell: "Wie hell der Klang bleibt.",
	Detune: "Wie weit die Stimmen gegeneinander verstimmt sind.",
	Drive: "Wie stark übersteuert wird.",
	Ton: "Die Tonhöhe oder Klangfarbe dieses Klangs.",
	Skala: "Die Tonleiter, auf die alle Töne gezogen werden.",
	Grundton: "Der Ton, auf dem die Tonleiter beginnt.",
	Zufall: "Wie viel Zufall dazukommt.",
	Bereich: "Wie weit die Werte auseinanderliegen dürfen.",
	Mutation: "Wie stark sich Kinder von ihren Eltern unterscheiden.",
	Futter: "Wie viel Futter in der Welt wächst.",
	Klima: "Das Klima der Welt. Die Farbe der Wesen zeigt, für welches Klima sie gebaut sind.",
	Wandel: "Wie schnell sich die Schleife verändert. Bei 0 bleibt sie für immer gleich.",
	Schleife: "Wiederholt die Aufnahme, solange das Gate an ist.",
	Punch: "Wie stark der Schlag am Anfang nach oben schnellt.",
	Rauschen: "Wie viel Rauschen im Schlag steckt.",
	Bits: "Wie grob der Klang gerastert wird.",
};
for (let n = 1; n <= 8; n++) KNOB[n] = "Die Tonhöhe dieses Schritts in Halbtönen.";

const fill = (text, dst) => text.replace("{dst}", dst);
const nameOf = (inst, dir, port) => (dir === "out" ? inst.def.outputs : inst.def.inputs)[port].name;
const comes = (inst, port) => OUT[inst.def.outputs[port].name] ?? OUT_KIND[inst.def.outputs[port].kind];
const does = (inst, port) => fill(INTO[`${inst.def.id}.${inst.def.inputs[port].name}`] ?? INTO[inst.def.inputs[port].name] ?? INTO_KIND[inst.def.inputs[port].kind], inst.def.name);

function cableText(rack, { from, to, tap }) {
	const [src, dst] = [rack.modules.get(from[0]), rack.modules.get(to[0])];
	const source = `${src.def.name} ${nameOf(src, "out", from[1])}`;
	if (tap) return `${source} bewegt den Regler ${dst.def.controls.find((c) => c.address === to[1]).label} am ${dst.def.name}.`;
	return `${source} geht in ${dst.def.name} ${nameOf(dst, "in", to[1])}. ${does(dst, to[1])}`;
}

// A walk through the patch, cable by cable, in the order of the modules.
function tour(rack) {
	const order = [...rack.modules.keys()];
	const cables = [...rack.cables, ...rack.mods].sort((a, b) => order.indexOf(a.from[0]) - order.indexOf(b.from[0]));
	const lines = cables.map((cable) => cableText(rack, cable));
	if (!lines.length) lines.push("Noch ist nichts verkabelt. Zieh ein Kabel von einem Ausgang (helles Feld) zu einem Eingang.");
	return { title: "So läuft dieser Patch", lines: [...lines, "Tippe etwas an, und ich erkläre es: ein Modul, eine Buchse, einen Regler oder ein Kabel."] };
}

// subject: { kind: "tour" } | { kind: "module", id, button } | { kind: "jack", id, dir, port } | { kind: "control", id, address } | { kind: "cable", item }
export function explanation(rack, subject) {
	const inst = rack.modules.get(subject.id);
	if (subject.kind === "module") {
		const buttons = { mute: "Der Knopf M schaltet dieses Modul stumm. Es läuft dann weiter, gibt aber nichts mehr aus.", close: "Das × entfernt das Modul mit all seinen Kabeln. „Zurück“ holt es wieder.", move: "Die Pfeile schieben das Modul eine Stelle weiter. Am Namen kannst du es auch ziehen." }[subject.button];
		const list = (ports, dir) => ports.map((port, i) => `${dir === "in" ? "Eingang" : "Ausgang"} ${port.name} (${KIND[port.kind][0]})${dir === "out" ? `: ${comes(inst, i)}` : ""}`);
		return { title: inst.def.name, lines: [...(buttons ? [buttons] : []), inst.def.description, ...list(inst.def.inputs, "in"), ...list(inst.def.outputs, "out")] };
	}
	if (subject.kind === "control") {
		const control = inst.def.controls.find((c) => c.address === subject.address);
		const movers = rack.mods.filter((m) => m.to[0] === subject.id && m.to[1] === subject.address).map((m) => `${rack.modules.get(m.from[0]).def.name} ${nameOf(rack.modules.get(m.from[0]), "out", m.from[1])}`);
		const range = control.type === "knob" ? [`Er geht von ${control.min} bis ${control.max}${control.unit ? ` ${control.unit}` : ""}. Ziehen dreht ihn, ein Doppelklick stellt ihn zurück.`] : [];
		return { title: `${inst.def.name}: ${control.label}`, lines: [KNOB[control.label] ?? `Stellt „${control.label}“ ein.`, ...range, ...(movers.length ? [`Gerade bewegt ihn ${movers.join(" und ")}. Der blaue Punkt zeigt, wo er steht.`] : ["Ein Kabel von einem Ausgang auf diesen Regler lässt ihn von selbst wandern."])] };
	}
	if (subject.kind === "jack") {
		const { dir, port } = subject;
		const kind = (dir === "out" ? inst.def.outputs : inst.def.inputs)[port].kind;
		const end = dir === "out" ? "from" : "to";
		const cables = [...rack.cables, ...(dir === "out" ? rack.mods : [])].filter((c) => c[end][0] === subject.id && c[end][1] === port);
		const role = dir === "out" ? `Ein Ausgang. Hier kommt heraus: ${comes(inst, port)}.` : `Ein Eingang. ${does(inst, port)}`;
		const source = dir === "out" ? { inst, port } : cables[0] ? { inst: rack.modules.get(cables[0].from[0]), port: cables[0].from[1] } : null;
		return { title: `${inst.def.name}: ${nameOf(inst, dir, port)}`, lines: [role, `${KIND[kind][0]}. ${KIND[kind][1]}`, ...(cables.length ? cables.map((c) => cableText(rack, c)) : ["Hier steckt noch kein Kabel."])], signal: source && { ...source, kind } };
	}
	if (subject.kind === "cable") {
		const src = rack.modules.get(subject.item.from[0]);
		const kind = src.def.outputs[subject.item.from[1]].kind;
		return { title: "Dieses Kabel", lines: [cableText(rack, subject.item), `${KIND[kind][0]}. ${KIND[kind][1]}`], signal: { inst: src, port: subject.item.from[1], kind } };
	}
	return tour(rack);
}

// Shows an explanation in the panel and, where there is a signal, what it is doing right now.
let watching = 0;
export function explain(panel, rack, subject) {
	const { title, lines, signal } = explanation(rack, subject);
	const canvas = Object.assign(document.createElement("canvas"), { width: 300, height: 60 });
	const now = document.createElement("output");
	panel.querySelector(".text").replaceChildren(Object.assign(document.createElement("h3"), { textContent: title }), ...lines.map((line) => Object.assign(document.createElement("p"), { textContent: line })), ...(signal ? [canvas, now] : []));
	panel.hidden = false;
	const watch = ++watching;
	if (!signal) return;
	const wave = new Float32Array(1024);
	const trail = [];
	const g = canvas.getContext("2d");
	const frame = () => {
		if (watch !== watching || panel.hidden || !rack.modules.has(signal.inst.id)) return;
		setTimeout(frame, 60);
		rack.modules.get(signal.inst.id).taps[signal.port].getFloatTimeDomainData(wave);
		const last = wave[1023];
		const peak = wave.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
		now.textContent = signal.kind === "gate" ? `Gerade: ${last > 0.5 ? "an" : "aus"}` : signal.kind === "cv" ? `Gerade: ${last.toFixed(2)}` : `Gerade: ${peak < 0.001 ? "still" : `Pegel ${peak.toFixed(2)}`}`;
		trail.push(last);
		trail.splice(0, trail.length - 100);
		const points = signal.kind === "audio" ? Array.from({ length: 300 }, (_, x) => wave[Math.floor((x * 512) / 300)]) : trail;
		const span = Math.max(1, ...points.map(Math.abs));
		g.fillStyle = "#0d0e11";
		g.fillRect(0, 0, 300, 60);
		g.beginPath();
		points.forEach((v, i) => g.lineTo((i * 300) / points.length, 30 - (v / span) * 27));
		g.strokeStyle = "#7ee0a1";
		g.stroke();
	};
	frame();
}
