import { hex, textEncode } from './util.ts'

export interface Pattern {
	bytes: Uint8Array
	mask: Uint8Array
}

export interface PatchStep {
	file: string
	op: 'replace' | 'rename_needed' | 'assert'
	pattern?: string
	with?: string
	from?: string
	to?: string
	contains?: string
	text?: string
	expect?: number
}

export interface PatchPack {
	format: number
	id: string
	target?: string
	steps: PatchStep[]
}

export interface StepLog {
	file: string
	op: string
	matches: number
	expect?: number
	ok: boolean
	message: string
}

export function parsePattern(spec: string): Pattern {
	const clean = spec.replace(/[\s_-]/g, '')
	if (clean.length % 2 !== 0) throw new Error('odd pattern length')
	const size = clean.length / 2
	const bytes = new Uint8Array(size)
	const mask = new Uint8Array(size)
	for (let i = 0; i < size; i++) {
		const pair = clean.slice(i * 2, i * 2 + 2)
		if (pair === '??') continue
		const byte = Number.parseInt(pair, 16)
		if (Number.isNaN(byte)) throw new Error(`bad pattern byte at ${i * 2}`)
		bytes[i] = byte
		mask[i] = 1
	}
	return { bytes, mask }
}

export function findPattern(data: Uint8Array, pattern: Pattern): number[] {
	const hits: number[] = []
	const span = data.length - pattern.bytes.length
	for (let at = 0; at <= span; at++) {
		let hit = true
		for (let i = 0; i < pattern.bytes.length; i++) {
			if (pattern.mask[i] && data[at + i] !== pattern.bytes[i]) {
				hit = false
				break
			}
		}
		if (hit) hits.push(at)
	}
	return hits
}

export function applyWith(
	original: Uint8Array,
	at: number,
	withSpec: string,
	into: Uint8Array,
): void {
	const patch = parsePattern(withSpec)
	if (patch.bytes.length === 0) throw new Error('empty replacement')
	for (let i = 0; i < patch.bytes.length; i++) {
		into[at + i] = patch.mask[i] ? patch.bytes[i] : original[at + i]
	}
}

export function replacePattern(
	data: Uint8Array,
	patternSpec: string,
	withSpec: string,
): { data: Uint8Array; count: number } {
	const pattern = parsePattern(patternSpec)
	const patch = parsePattern(withSpec)
	if (patch.bytes.length !== pattern.bytes.length)
		throw new Error('replacement must match pattern length')
	const hits = findPattern(data, pattern)
	const out = data.slice()
	for (const at of hits) applyWith(data, at, withSpec, out)
	return { data: out, count: hits.length }
}

function elfView(data: Uint8Array): DataView {
	if (data.length < 64) throw new Error('not an elf')
	if (
		!(
			data[0] === 0x7f &&
			data[1] === 0x45 &&
			data[2] === 0x4c &&
			data[3] === 0x46
		)
	)
		throw new Error('not an elf')
	if (data[4] !== 2) throw new Error('only elf64 supported')
	if (data[5] !== 1) throw new Error('only little endian supported')
	return new DataView(data.buffer, data.byteOffset)
}

interface LoadSpan {
	vaddr: number
	offset: number
	filesz: number
}

function strtabFileOffset(
	data: Uint8Array,
	dynOffset: number,
	dynFilesz: number,
	loads: LoadSpan[],
): { at: number; size: number } {
	const view = elfView(data)
	let strtabVaddr = -1
	let strtabSize = 0
	for (let at = dynOffset; at + 16 <= dynOffset + dynFilesz; at += 16) {
		const tag = Number(view.getBigUint64(at, true))
		const val = Number(view.getBigUint64(at + 8, true))
		if (tag === 0) break
		if (tag === 5) strtabVaddr = val
		if (tag === 10) strtabSize = val
	}
	if (strtabVaddr < 0 || strtabSize <= 0)
		throw new Error('dynamic string table not found')
	for (const load of loads) {
		if (
			strtabVaddr >= load.vaddr &&
			strtabVaddr + strtabSize <= load.vaddr + load.filesz
		) {
			return { at: load.offset + (strtabVaddr - load.vaddr), size: strtabSize }
		}
	}
	throw new Error('string table not covered by a load segment')
}

function dynamicSpans(data: Uint8Array): {
	dyn: { offset: number; filesz: number }
	loads: LoadSpan[]
} {
	const view = elfView(data)
	const phoff = Number(view.getBigUint64(32, true))
	const phentsize = view.getUint16(54, true)
	const phnum = view.getUint16(56, true)
	const loads: LoadSpan[] = []
	let dyn = { offset: 0, filesz: 0 }
	for (let i = 0; i < phnum; i++) {
		const at = phoff + i * phentsize
		const type = view.getUint32(at, true)
		const offset = Number(view.getBigUint64(at + 8, true))
		const vaddr = Number(view.getBigUint64(at + 16, true))
		const filesz = Number(view.getBigUint64(at + 32, true))
		if (type === 1) loads.push({ vaddr, offset, filesz })
		if (type === 2) dyn = { offset, filesz }
	}
	if (!dyn.filesz) throw new Error('no dynamic segment')
	return { dyn, loads }
}

export function renameNeeded(
	data: Uint8Array,
	from: string,
	to: string,
): { data: Uint8Array; count: number } {
	const fromBytes = textEncode(from)
	const toBytes = textEncode(to)
	if (fromBytes.length !== toBytes.length)
		throw new Error('elf dependency rename must keep the name length')
	const { dyn, loads } = dynamicSpans(data)
	const strtab = strtabFileOffset(data, dyn.offset, dyn.filesz, loads)
	const out = data.slice()
	let count = 0
	for (
		let at = strtab.at;
		at + fromBytes.length <= strtab.at + strtab.size;
		at++
	) {
		if (at > strtab.at && data[at - 1] !== 0) continue
		if (data[at + fromBytes.length] !== 0) continue
		let hit = true
		for (let i = 0; i < fromBytes.length; i++) {
			if (data[at + i] !== fromBytes[i]) {
				hit = false
				break
			}
		}
		if (!hit) continue
		out.set(toBytes, at)
		count++
		at += fromBytes.length
	}
	return { data: out, count }
}

export function runStep(
	files: Map<string, Uint8Array>,
	step: PatchStep,
): StepLog {
	const base = { file: step.file, op: step.op, matches: 0, expect: step.expect }
	const data = files.get(step.file)
	if (!data) return { ...base, ok: false, message: 'file missing' }
	try {
		if (step.op === 'replace') {
			if (!step.pattern || step.with === undefined)
				throw new Error('replace needs pattern and with')
			const result = replacePattern(data, step.pattern, step.with)
			files.set(step.file, result.data)
			return finish(base, result.count)
		}
		if (step.op === 'rename_needed') {
			if (!step.from || !step.to)
				throw new Error('rename_needed needs from and to')
			const result = renameNeeded(data, step.from, step.to)
			files.set(step.file, result.data)
			return finish(base, result.count)
		}
		if (step.op === 'assert') {
			if (step.contains && step.text)
				throw new Error('assert takes contains or text')
			if (step.contains) {
				const hits = findPattern(data, parsePattern(step.contains))
				return finish(base, hits.length)
			}
			if (step.text) {
				const needle = textEncode(step.text)
				const haystack = hex(data)
				const count = haystack.split(hex(needle)).length - 1
				return finish(base, count)
			}
			throw new Error('assert needs contains or text')
		}
		throw new Error(`unknown op ${step.op}`)
	} catch (err) {
		return {
			...base,
			ok: false,
			message: err instanceof Error ? err.message : String(err),
		}
	}
}

function finish(
	base: { file: string; op: string; matches: number; expect?: number },
	count: number,
): StepLog {
	const ok = base.expect === undefined ? count > 0 : count === base.expect
	return {
		...base,
		matches: count,
		ok,
		message: ok
			? `${count} match${count === 1 ? '' : 'es'}`
			: `expected ${base.expect ?? 'at least 1'}, found ${count}`,
	}
}

export function runPack(
	files: Map<string, Uint8Array>,
	pack: PatchPack,
): StepLog[] {
	if (pack.format !== 1)
		throw new Error(`unsupported patch pack format ${pack.format}`)
	if (!Array.isArray(pack.steps)) throw new Error('patch pack needs steps')
	for (const step of pack.steps) {
		if (
			step.op !== 'replace' &&
			step.op !== 'rename_needed' &&
			step.op !== 'assert'
		) {
			throw new Error(`unknown op ${step.op}`)
		}
	}
	return pack.steps.map(step => runStep(files, step))
}

export function describeStep(step: PatchStep): string {
	if (step.op === 'replace') return `replace ${step.pattern} in ${step.file}`
	if (step.op === 'rename_needed')
		return `rename ${step.from} to ${step.to} in ${step.file}`
	return `assert ${step.contains ?? step.text} in ${step.file}`
}
