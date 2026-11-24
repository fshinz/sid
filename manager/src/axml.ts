import {
	concat,
	le32,
	readLe16,
	readLe32,
	textDecode,
	textEncode,
} from './util.ts'

const RES_XML_TYPE = 0x0003
const RES_STRING_POOL_TYPE = 0x0001
const UTF8_FLAG = 0x100

interface Pool {
	at: number
	size: number
	stringCount: number
	flags: number
	stringsStart: number
	stylesStart: number
	offsets: number[]
}

function readPool(doc: Uint8Array): Pool {
	const view = new DataView(doc.buffer, doc.byteOffset)
	if (view.getUint16(0, true) !== RES_XML_TYPE)
		throw new Error('not binary xml')
	if (view.getUint16(8, true) !== RES_STRING_POOL_TYPE)
		throw new Error('string pool missing')
	const size = view.getUint32(12, true)
	const stringCount = view.getUint32(16, true)
	const styleCount = view.getUint32(20, true)
	const flags = view.getUint32(24, true)
	const stringsStart = view.getUint32(28, true)
	const stylesStart = view.getUint32(32, true)
	if (styleCount !== 0 || stylesStart !== 0)
		throw new Error('styled strings unsupported')
	const offsets: number[] = []
	for (let i = 0; i < stringCount; i++)
		offsets.push(view.getUint32(36 + i * 4, true))
	return { at: 8, size, stringCount, flags, stringsStart, stylesStart, offsets }
}

function readString(doc: Uint8Array, pool: Pool, index: number): string {
	const base = pool.at + pool.stringsStart + pool.offsets[index]
	const isUtf8 = (pool.flags & UTF8_FLAG) !== 0
	if (isUtf8) {
		let at = base
		let len = doc[at++]
		if (len & 0x80) at++
		len = doc[at++]
		if (len & 0x80) {
			len = ((len & 0x7f) << 8) | doc[at]
			at++
		}
		return textDecode(doc.subarray(at, at + len))
	}
	let at = base
	let len = readLe32(doc, at) & 0xffff
	at += 2
	if (len & 0x8000) {
		len = ((len & 0x7fff) << 16) | readLe32(doc, at - 2 + 2)
		at += 2
	}
	return new TextDecoder('utf-16le').decode(doc.subarray(at, at + len * 2))
}

function encodeString(value: string, isUtf8: boolean): Uint8Array {
	if (!isUtf8) {
		const units = []
		for (const ch of value) {
			const code = ch.codePointAt(0) as number
			if (code > 0xffff) {
				const v = code - 0x10000
				units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
			} else {
				units.push(code)
			}
		}
		const out = new Uint8Array(2 + units.length * 2 + 2)
		out.set([units.length & 0xff, units.length >> 8], 0)
		const view = new DataView(out.buffer)
		units.forEach((u, i) => view.setUint16(2 + i * 2, u, true))
		return out
	}
	const bytes = textEncode(value)
	const head: number[] = [value.length & 0x7f]
	if (value.length > 0x7f)
		head.push(0x80 | (value.length >> 7), value.length & 0x7f)
	head.push(bytes.length & 0x7f)
	if (bytes.length > 0x7f)
		head.push(0x80 | (bytes.length >> 7), bytes.length & 0x7f)
	return concat(new Uint8Array(head), bytes, new Uint8Array([0]))
}

export function findString(doc: Uint8Array, value: string): number {
	const pool = readPool(doc)
	for (let i = 0; i < pool.stringCount; i++) {
		if (readString(doc, pool, i) === value) return i
	}
	return -1
}

export function listStrings(doc: Uint8Array): string[] {
	const pool = readPool(doc)
	const out: string[] = []
	for (let i = 0; i < pool.stringCount; i++) out.push(readString(doc, pool, i))
	return out
}

export function replaceString(
	doc: Uint8Array,
	index: number,
	value: string,
): Uint8Array {
	const pool = readPool(doc)
	if (index < 0 || index >= pool.stringCount)
		throw new Error('string index out of range')
	const isUtf8 = (pool.flags & UTF8_FLAG) !== 0
	const chunks: Uint8Array[] = []
	for (let i = 0; i < pool.stringCount; i++)
		chunks.push(
			encodeString(i === index ? value : readString(doc, pool, i), isUtf8),
		)
	const offsets: Uint8Array[] = []
	let running = 0
	for (const chunk of chunks) {
		offsets.push(le32(running))
		running += chunk.length
	}
	const data = concat(...chunks)
	const stringsStart = 28 + pool.stringCount * 4
	const size = stringsStart + data.length
	const head = concat(
		new Uint8Array([
			RES_STRING_POOL_TYPE & 0xff,
			RES_STRING_POOL_TYPE >> 8,
			16,
			0,
		]),
		le32(size),
		le32(pool.stringCount),
		le32(0),
		le32(pool.flags),
		le32(stringsStart),
		le32(0),
		...offsets,
	)
	const built = concat(head, data)
	const after = doc.subarray(pool.at + pool.size)
	return concat(doc.subarray(0, pool.at), built, after)
}

export function replaceValue(
	doc: Uint8Array,
	from: string,
	to: string,
): Uint8Array {
	const index = findString(doc, from)
	if (index < 0) throw new Error(`string not found: ${from}`)
	return replaceString(doc, index, to)
}

export function isBinaryXml(doc: Uint8Array): boolean {
	return (
		doc.length > 8 &&
		readLe16(doc, 0) === RES_XML_TYPE &&
		readLe16(doc, 2) === 8
	)
}
