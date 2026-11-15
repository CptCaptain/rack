// Modules written or changed in the Editor. They live in this browser only:
// { id: { dsp, json } }. An entry for a module the server also has replaces it here.
const KEY = "faust-rack.edits";

export const edits = {
	all: () => JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "{}"),
	set: (id, edit) => localStorage.setItem(KEY, JSON.stringify({ ...edits.all(), [id]: edit })),
	remove: (id) => localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(Object.entries(edits.all()).filter(([key]) => key !== id)))),
};
