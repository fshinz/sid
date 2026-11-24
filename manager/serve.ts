const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.ts': 'text/javascript; charset=utf-8',
	'.json': 'application/json',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
}

const root = new URL('.', import.meta.url).pathname

export default {
	port: 4173,
	hostname: '0.0.0.0',
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)
		const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
		const file = Bun.file(`${root}${rel}`)
		if (!(await file.exists()))
			return new Response('not found', { status: 404 })
		const ext = rel.slice(rel.lastIndexOf('.'))
		if (ext === '.ts') {
			const code = await file.text()
			const transpiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(
				code,
			)
			return new Response(transpiled, {
				headers: { 'content-type': MIME['.js'] },
			})
		}
		return new Response(file, {
			headers: { 'content-type': MIME[ext] ?? 'application/octet-stream' },
		})
	},
}
