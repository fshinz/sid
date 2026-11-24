const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json",
	".png": "image/png",
	".svg": "image/svg+xml",
};

const root = new URL(".", import.meta.url).pathname;

export default {
	port: 4173,
	hostname: "0.0.0.0",
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
		if (rel === "app.js") {
			const build = await Bun.build({ entrypoints: [`${root}src/app.ts`], target: "browser", format: "esm" });
			return new Response(await build.outputs[0].text(), { headers: { "content-type": MIME[".js"] } });
		}
		const path = rel === "styles.css" ? "src/styles.css" : rel;
		const file = Bun.file(`${root}${path}`);
		if (!(await file.exists())) return new Response("not found", { status: 404 });
		const ext = path.slice(path.lastIndexOf("."));
		return new Response(file, { headers: { "content-type": MIME[ext] ?? "application/octet-stream" } });
	},
};
