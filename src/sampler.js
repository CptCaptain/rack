// Module widget "sampler": names the loaded sample and takes a new one from a file,
// through the button or by dropping the file on the module.
export function sampler(def, io) {
	const el = document.createElement("div");
	el.className = "sampler";
	const name = document.createElement("span");
	name.textContent = io.sample() || "Glocke (eingebaut)";
	const input = Object.assign(document.createElement("input"), { type: "file", accept: "audio/*", hidden: true });
	const button = document.createElement("button");
	button.textContent = "Datei laden …";
	button.addEventListener("click", () => input.click());
	const take = (file) => file && io.loadSample(file).catch((err) => (name.textContent = `Geht nicht: ${err.message}`));
	input.addEventListener("change", () => take(input.files[0]));
	el.addEventListener("dragover", (e) => e.preventDefault());
	el.addEventListener("drop", (e) => {
		e.preventDefault();
		take(e.dataTransfer.files[0]);
	});
	el.append(name, button, input);
	return el;
}
