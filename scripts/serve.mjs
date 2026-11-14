import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TYPES = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".wasm": "application/wasm",
	".dsp": "text/plain; charset=utf-8",
};

export function serve(dir, port = 0, host = "127.0.0.1") {
	const root = resolve(dir);
	const server = createServer((req, res) => {
		const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
		let file = join(root, path);
		try {
			if (!file.startsWith(root)) throw new Error("outside root");
			if (statSync(file).isDirectory()) file = join(file, "index.html");
			const { size } = statSync(file);
			res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "content-length": size, "cache-control": "no-cache" });
			createReadStream(file).pipe(res);
		} catch {
			res.writeHead(404).end("not found");
		}
	});
	return new Promise((done) => server.listen(port, host, () => done(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const server = await serve(process.argv[2] ?? ".", Number(process.env.PORT ?? 5173), process.env.HOST);
	console.log(`http://localhost:${server.address().port}`);
}
