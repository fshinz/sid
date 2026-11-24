import { isBinaryXml, replaceValue } from './axml.ts'
import { runPack } from './patch.ts'
import { fetchDist, parseIndex, pickChannel } from './pool.ts'
import {
	certFingerprint,
	generateSigner,
	pemPkcs8,
	pemSpki,
	signV3,
	verifyV3,
} from './sign.ts'
import { fmtSize, sha256hex, textDecode, textEncode } from './util.ts'
import { entryData, parseZip, writeZip } from './zip.ts'
import type { PatchPack, PatchStep } from './patch.ts'
import type { PluginEntry } from './pool.ts'
import type { Signer } from './sign.ts'
import type { ZipEntry, ZipWriteEntry } from './zip.ts'

const DENSITIES = [
	'ldpi',
	'mdpi',
	'hdpi',
	'xhdpi',
	'xxhdpi',
	'xxxhdpi',
	'tvdpi',
	'nodpi',
]
const LANGS = [
	'en',
	'ar',
	'bg',
	'cs',
	'da',
	'de',
	'el',
	'es',
	'fi',
	'fr',
	'hi',
	'hr',
	'hu',
	'id',
	'it',
	'ja',
	'ko',
	'lt',
	'nl',
	'pl',
	'pt',
	'ro',
	'ru',
	'sv',
	'th',
	'tr',
	'uk',
	'vi',
	'zh',
]
const ABIS = ['arm64_v8a', 'armeabi_v7a', 'x86_64', 'x86', 'universal']
const DEMO_PACK_URL = 'packs/example.patch.json'
const DEMO_POOL_URL = 'packs/demo-pool.json'

interface PickedFile {
	name: string
	data: Uint8Array
	sha: string
	role: 'base' | 'abi' | 'density' | 'lang' | 'other'
	tag: string
}

interface CustomScript {
	name: string
	source: string
}

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Record<string, unknown> = {},
	...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag)
	for (const [key, value] of Object.entries(props)) {
		if (key === 'class') node.className = String(value)
		else if (key === 'text') node.textContent = String(value)
		else if (key.startsWith('on'))
			node.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
		else node.setAttribute(key, String(value))
	}
	for (const child of children) node.append(child)
	return node
}

function classify(name: string): { role: PickedFile['role']; tag: string } {
	const tokens = name
		.toLowerCase()
		.split(/[.\-_]/)
		.filter(Boolean)
	if (tokens.some(token => token === 'base' || token === 'master'))
		return { role: 'base', tag: '' }
	for (const token of tokens) {
		if (ABIS.includes(token)) return { role: 'abi', tag: token }
		if (DENSITIES.includes(token)) return { role: 'density', tag: token }
		if (LANGS.includes(token)) return { role: 'lang', tag: token }
	}
	return { role: 'other', tag: '' }
}

const state = {
	files: [] as PickedFile[],
	densities: new Set<string>(),
	langs: new Set<string>(),
	installMode: 'next' as 'next' | 'replace',
	oldPackage: 'com.discord.release',
	newPackage: 'dev.valenced.phoenix',
	pool: null as ReturnType<typeof parseIndex> | null,
	channel: 'stable',
	pickedPlugins: new Set<string>(),
	customs: [] as CustomScript[],
	packText: '',
	signer: null as Signer | null,
	lastBlobUrl: '',
}

function log(line: string, cls: '' | 'ok' | 'bad' | 'muted' = ''): void {
	const box = document.getElementById('console') as HTMLElement
	const span = el('span', { class: cls, text: `${line}\n` })
	box.append(span)
	box.scrollTop = box.scrollHeight
}

async function addFiles(list: FileList | File[]): Promise<void> {
	for (const file of Array.from(list)) {
		const data = new Uint8Array(await file.arrayBuffer())
		const { role, tag } = classify(file.name)
		state.files.push({
			name: file.name,
			data,
			sha: await sha256hex(data),
			role,
			tag,
		})
	}
	renderFiles()
}

function keptFiles(): PickedFile[] {
	return state.files.filter(file => {
		if (file.role === 'density')
			return state.densities.size === 0 || state.densities.has(file.tag)
		if (file.role === 'lang')
			return state.langs.size === 0 || state.langs.has(file.tag)
		return true
	})
}

function renderFiles(): void {
	const mount = document.getElementById('files-table') as HTMLElement
	mount.replaceChildren()
	if (state.files.length === 0) return
	const kept = new Set(keptFiles().map(file => file.name))
	const rows = state.files.map(file =>
		el(
			'tr',
			{ class: kept.has(file.name) ? '' : 'pruned' },
			el('td', { class: 'name', text: file.name }),
			el(
				'td',
				{},
				el('span', {
					class: `chip ${file.role}`,
					text: file.role + (file.tag ? ` ${file.tag}` : ''),
				}),
			),
			el('td', { class: 'size', text: fmtSize(file.data.length) }),
			el('td', { class: 'name', text: file.sha.slice(0, 12) }),
		),
	)
	mount.append(
		el(
			'table',
			{ class: 'files' },
			el(
				'thead',
				{},
				el(
					'tr',
					{},
					el('th', { text: 'file' }),
					el('th', { text: 'role' }),
					el('th', { text: 'size' }),
					el('th', { text: 'sha256' }),
				),
			),
			el('tbody', {}, ...rows),
		),
	)
}

function renderChips(): void {
	const densityBox = document.getElementById('density-chips') as HTMLElement
	densityBox.replaceChildren(
		...DENSITIES.map(tag =>
			el('button', {
				class: `ghost${state.densities.has(tag) ? '' : ' off'}`,
				text: tag,
				onClick: () => {
					if (state.densities.has(tag)) state.densities.delete(tag)
					else state.densities.add(tag)
					renderChips()
					renderFiles()
				},
			}),
		),
	)
	const langBox = document.getElementById('lang-chips') as HTMLElement
	langBox.replaceChildren(
		...LANGS.map(tag =>
			el('button', {
				class: `ghost${state.langs.has(tag) ? '' : ' off'}`,
				text: tag,
				onClick: () => {
					if (state.langs.has(tag)) state.langs.delete(tag)
					else state.langs.add(tag)
					renderChips()
					renderFiles()
				},
			}),
		),
	)
}

function renderPlugins(): void {
	const mount = document.getElementById('plugin-list') as HTMLElement
	mount.replaceChildren()
	if (!state.pool) return
	const entries = state.pool.plugins.slice(0, 24)
	mount.append(
		...entries.map((entry: PluginEntry) =>
			el(
				'label',
				{ class: 'toggle' },
				el('input', {
					type: 'checkbox',
					...(state.pickedPlugins.has(entry.id) ? { checked: 'checked' } : {}),
					onChange: (event: Event) => {
						if ((event.target as HTMLInputElement).checked)
							state.pickedPlugins.add(entry.id)
						else state.pickedPlugins.delete(entry.id)
					},
				}),
				el(
					'span',
					{},
					el('span', {
						class: 't-name',
						text: `${entry.name} ${entry.version}`,
					}),
					el('br'),
					el('span', { class: 't-desc', text: entry.description }),
				),
			),
		),
	)
}

async function loadPool(url: string): Promise<void> {
	try {
		const response = await fetch(url)
		state.pool = parseIndex(await response.json())
		state.pickedPlugins.clear()
		renderPlugins()
		log(`pool loaded: ${state.pool.plugins.length} plugins`, 'ok')
	} catch (err) {
		log(`pool failed: ${err instanceof Error ? err.message : err}`, 'bad')
	}
}

async function collectPlugins(): Promise<Map<string, string>> {
	const out = new Map<string, string>()
	if (state.pool) {
		for (const entry of state.pool.plugins) {
			if (!state.pickedPlugins.has(entry.id)) continue
			const dist = pickChannel(entry, state.channel)
			if (!dist) continue
			try {
				const data = await fetchDist(dist)
				out.set(`${entry.id}.js`, textDecode(data))
				log(`downloaded ${entry.id} ${entry.version}`, 'ok')
			} catch (err) {
				log(`${entry.id}: ${err instanceof Error ? err.message : err}`, 'bad')
				throw new Error(`plugin ${entry.id} failed`)
			}
		}
	}
	for (const script of state.customs) out.set(script.name, script.source)
	return out
}

async function runPipeline(): Promise<void> {
	const button = document.getElementById('run') as HTMLButtonElement
	button.disabled = true
	const box = document.getElementById('console') as HTMLElement
	box.replaceChildren()
	try {
		const kept = keptFiles()
		if (kept.length === 0) throw new Error('no main files')
		log(`merging ${kept.length} file${kept.length === 1 ? '' : 's'}`)
		const order = { base: 0, abi: 1, density: 2, lang: 3, other: 4 } as const
		const sorted = [...kept].sort((a, b) => order[a.role] - order[b.role])
		const merged = new Map<string, ZipEntry>()
		for (const file of sorted) {
			for (const entry of parseZip(file.data)) {
				if (merged.has(entry.name))
					throw new Error(`duplicate entry ${entry.name} in ${file.name}`)
				merged.set(entry.name, entry)
			}
			log(`  ${file.name}`, 'muted')
		}
		const work = new Map<string, Uint8Array>()
		const ensure = async (name: string): Promise<Uint8Array> => {
			const cached = work.get(name)
			if (cached) return cached
			const entry = merged.get(name)
			if (!entry) throw new Error(`entry missing: ${name}`)
			const data = await entryData(entry)
			work.set(name, data)
			return data
		}
		const manifest = await ensure('AndroidManifest.xml')
		if (!isBinaryXml(manifest))
			throw new Error('AndroidManifest.xml is not binary xml')
		if (state.installMode === 'next') {
			const patched = replaceValue(manifest, state.oldPackage, state.newPackage)
			work.set('AndroidManifest.xml', patched)
			log(`package ${state.oldPackage} -> ${state.newPackage}`, 'ok')
		} else {
			log(`keeping package ${state.oldPackage}`, 'muted')
		}
		const plugins = await collectPlugins()
		if (plugins.size > 0) {
			const index = JSON.stringify({
				format: 1,
				plugins: [...plugins.keys()].map(name => ({
					id: name.replace(/\.js$/, ''),
					script: `plugins/${name}`,
				})),
			})
			for (const [name, source] of plugins)
				work.set(`assets/valenced/plugins/${name}`, textEncode(source))
			work.set('assets/valenced/index.json', textEncode(index))
			log(
				`embedded ${plugins.size} plugin${plugins.size === 1 ? '' : 's'}`,
				'ok',
			)
		}
		const pack = JSON.parse(state.packText) as PatchPack
		const touched = new Set<string>()
		for (const step of pack.steps as PatchStep[]) touched.add(step.file)
		for (const name of touched) if (merged.has(name)) await ensure(name)
		const logLines = runPack(work, pack)
		for (const line of logLines) {
			log(
				`${line.ok ? 'ok  ' : 'FAIL'} ${line.op} ${line.file}: ${line.message}`,
				line.ok ? 'ok' : 'bad',
			)
		}
		if (logLines.some(line => !line.ok)) throw new Error('patch pack failed')
		log('building apk')
		const entries: ZipWriteEntry[] = []
		for (const [name, entry] of merged) {
			const patched = work.get(name)
			if (patched) entries.push({ name, data: patched, method: 0 })
			else
				entries.push({ name, data: new Uint8Array(0), method: 0, raw: entry })
		}
		for (const [name, data] of work) {
			if (!merged.has(name)) entries.push({ name, data, method: 0 })
		}
		const unsigned = await writeZip(entries)
		log(`unsigned apk ${fmtSize(unsigned.length)}`, 'muted')
		if (!state.signer) state.signer = await generateSigner('Valenced Manager')
		const signed = await signV3(unsigned, state.signer)
		if (!(await verifyV3(signed.apk, state.signer.cert)))
			throw new Error('signature self check failed')
		log(`signed apk ${fmtSize(signed.apk.length)}`, 'ok')
		log(`cert sha256 ${await certFingerprint(state.signer.cert)}`, 'muted')
		const blob = new Blob([signed.apk as BlobPart], {
			type: 'application/vnd.android.package-archive',
		})
		if (state.lastBlobUrl) URL.revokeObjectURL(state.lastBlobUrl)
		state.lastBlobUrl = URL.createObjectURL(blob)
		const out = document.getElementById('output') as HTMLElement
		out.replaceChildren(
			el(
				'a',
				{ href: state.lastBlobUrl, download: 'valenced-phoenix.apk' },
				el('button', { text: 'Download patched APK' }),
			),
			el('button', {
				class: 'ghost',
				text: 'Download signing key',
				onClick: async () => {
					if (!state.signer) return
					download('valenced-key.pem', await pemPkcs8(state.signer.key))
					download('valenced-cert.pem', await pemSpki(state.signer.key))
				},
			}),
		)
		log('done')
	} catch (err) {
		log(err instanceof Error ? err.message : String(err), 'bad')
	} finally {
		button.disabled = false
	}
}

function download(name: string, body: string | Uint8Array): void {
	const blob = new Blob([body as BlobPart])
	const url = URL.createObjectURL(blob)
	const link = el('a', { href: url, download: name })
	document.body.append(link)
	link.click()
	link.remove()
	URL.revokeObjectURL(url)
}

async function boot(): Promise<void> {
	const app = document.getElementById('app') as HTMLElement
	app.append(
		el(
			'header',
			{ class: 'top' },
			el('h1', { text: 'Valenced Manager' }),
			el('span', {
				class: 'sub',
				text: 'runs in this browser, nothing is uploaded',
			}),
		),
		el(
			'section',
			{ class: 'card' },
			el('h2', { text: 'Main files' }),
			el('p', {
				class: 'hint',
				text: 'Discord splits from your download folder, picked all at once.',
			}),
			el('div', {
				class: 'drop',
				id: 'drop',
				text: 'Drop the split APKs here, or click to pick',
				onClick: () => document.getElementById('picker')?.click(),
			}),
			el('input', {
				type: 'file',
				id: 'picker',
				accept: '.apk',
				multiple: 'multiple',
				style: 'display:none',
				onChange: (event: Event) =>
					addFiles((event.target as HTMLInputElement).files ?? []),
			}),
			el('div', { id: 'files-table' }),
		),
		el(
			'section',
			{ class: 'card' },
			el('h2', { text: 'Configure' }),
			el('p', {
				class: 'hint',
				text: 'Unpicked densities and languages are pruned from the merge.',
			}),
			el('div', { class: 'row', id: 'density-chips' }),
			el('div', { class: 'row', id: 'lang-chips' }),
			el(
				'div',
				{ class: 'row' },
				el('label', { text: 'Install' }),
				el(
					'select',
					{
						id: 'install-mode',
						onChange: (event: Event) => {
							state.installMode = (event.target as HTMLSelectElement).value as
								| 'next'
								| 'replace'
						},
					},
					el('option', { value: 'next', text: 'Next to Discord' }),
					el('option', { value: 'replace', text: 'Replace Discord' }),
				),
			),
			el(
				'div',
				{ class: 'row' },
				el('label', { text: 'Package' }),
				el('input', {
					type: 'text',
					id: 'old-package',
					value: state.oldPackage,
					onChange: (event: Event) => {
						state.oldPackage = (event.target as HTMLInputElement).value.trim()
					},
				}),
				el('input', {
					type: 'text',
					id: 'new-package',
					value: state.newPackage,
					onChange: (event: Event) => {
						state.newPackage = (event.target as HTMLInputElement).value.trim()
					},
				}),
			),
		),
		el(
			'section',
			{ class: 'card' },
			el('h2', { text: 'Plugins' }),
			el('p', {
				class: 'hint',
				text: 'Downloaded at patch time, packed into the build.',
			}),
			el(
				'div',
				{ class: 'row' },
				el('input', {
					type: 'url',
					id: 'pool-url',
					value: DEMO_POOL_URL,
					placeholder: 'pool index.json url',
				}),
				el('button', {
					class: 'ghost',
					text: 'Load pool',
					onClick: () =>
						loadPool(
							(document.getElementById('pool-url') as HTMLInputElement).value,
						),
				}),
				el(
					'select',
					{
						id: 'channel',
						onChange: (event: Event) => {
							state.channel = (event.target as HTMLSelectElement).value
						},
					},
					el('option', { value: 'stable', text: 'stable' }),
					el('option', { value: 'beta', text: 'beta' }),
					el('option', { value: 'canary', text: 'canary' }),
				),
			),
			el('div', { class: 'toggles', id: 'plugin-list' }),
			el('textarea', {
				id: 'custom-js',
				placeholder: '// your plugin scripts',
				spellcheck: 'false',
			}),
			el(
				'div',
				{ class: 'row' },
				el('button', {
					class: 'ghost',
					text: 'Add custom script',
					onClick: () => {
						const area = document.getElementById(
							'custom-js',
						) as HTMLTextAreaElement
						const source = area.value.trim()
						if (!source) return
						const name = `custom-${state.customs.length + 1}.js`
						state.customs.push({ name, source })
						area.value = ''
						;(
							document.getElementById('custom-count') as HTMLElement
						).textContent = `${state.customs.length} custom scripts`
						log(`added ${name}`, 'ok')
					},
				}),
				el('span', {
					class: 'pill-note',
					id: 'custom-count',
					text: `${state.customs.length} custom scripts`,
				}),
			),
		),
		el(
			'section',
			{ class: 'card' },
			el('h2', { text: 'Patches' }),
			el('p', {
				class: 'hint',
				text: 'Applied at the end, over the merged build.',
			}),
			el('textarea', { id: 'pack', spellcheck: 'false' }),
			el(
				'div',
				{ class: 'row' },
				el('button', {
					class: 'ghost',
					text: 'Load example',
					onClick: async () => {
						const response = await fetch(DEMO_PACK_URL)
						state.packText = await response.text()
						;(document.getElementById('pack') as HTMLTextAreaElement).value =
							state.packText
					},
				}),
				el('button', {
					id: 'run',
					text: 'Patch & sign',
					onClick: () => {
						state.packText = (
							document.getElementById('pack') as HTMLTextAreaElement
						).value
						runPipeline()
					},
				}),
			),
		),
		el(
			'section',
			{ class: 'card' },
			el('h2', { text: 'Output' }),
			el('div', { class: 'console', id: 'console' }),
			el('div', { class: 'output', id: 'output' }),
			el('p', {
				class: 'pill-note',
				text: 'Signed with a fresh key. Installing over a differently signed build needs a uninstall first. Keep the key to update later builds.',
			}),
		),
		el('footer', {
			text: 'Valenced Manager, unofficial and not affiliated with Discord',
		}),
	)
	const drop = document.getElementById('drop') as HTMLElement
	drop.addEventListener('dragover', event => {
		event.preventDefault()
		drop.classList.add('over')
	})
	drop.addEventListener('dragleave', () => drop.classList.remove('over'))
	drop.addEventListener('drop', event => {
		event.preventDefault()
		drop.classList.remove('over')
		if (event.dataTransfer) addFiles(event.dataTransfer.files)
	})
	renderChips()
	const response = await fetch(DEMO_PACK_URL)
	state.packText = await response.text()
	;(document.getElementById('pack') as HTMLTextAreaElement).value =
		state.packText
}

void boot()
