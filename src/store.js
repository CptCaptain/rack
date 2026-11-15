// A small key-value store in the browser's IndexedDB: one database with one table.
export function table(database, name) {
	const open = () =>
		new Promise((done, fail) => {
			const request = indexedDB.open(database, 1);
			request.onupgradeneeded = () => request.result.createObjectStore(name);
			request.onsuccess = () => done(request.result.transaction(name, "readwrite").objectStore(name));
			request.onerror = () => fail(request.error);
		});
	const run = async (action) => {
		const request = action(await open());
		return new Promise((done, fail) => ((request.onsuccess = () => done(request.result)), (request.onerror = () => fail(request.error))));
	};
	return {
		get: (key) => run((store) => store.get(key)),
		put: (key, value) => run((store) => store.put(value, key)),
		delete: (key) => run((store) => store.delete(key)),
		keys: () => run((store) => store.getAllKeys()),
	};
}
