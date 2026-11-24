import { concat, crc32, le16, le32, textDecode, textEncode } from './util.ts'

export interface ZipEntry {
	name: string
	method: number
	crc: number
	compSize: number
	uncompSize: number
	compData: Uint8Array
}

export interface ZipWriteEntry {
	name: string
	data: Uint8Array
	method: 0 | 8
	deflate?: (data: Uint8Array) => Uint8Array
	raw?: ZipEntry
}

const LOCAL_SIG = 0x04034b50
const CD_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const EOCD_MIN = 22
const EOCD_MAX = EOCD_MIN + 0xffff

export function parseZip(buf: Uint8Array): ZipEntry[] {
	const view = new DataView(buf.buffer, buf.byteOffset)
	let eocd = -1
	const scanFrom = Math.max(0, buf.length - EOCD_MAX)
	for (let at = buf.length - EOCD_MIN; at >= scanFrom; at--) {
		if (view.getUint32(at, true) === EOCD_SIG) {
			eocd = at
			break
		}
	}
	if (eocd < 0) throw new Error('not a zip: end of central directory missing')
	const count = view.getUint16(eocd + 10, true)
	let at = view.getUint32(eocd + 16, true)
	const entries: ZipEntry[] = []
	for (let i = 0; i < count; i++) {
		if (view.getUint32(at, true) !== CD_SIG)
			throw new Error('bad central directory')
		const method = view.getUint16(at + 10, true)
		const crc = view.getUint32(at + 16, true)
		const compSize = view.getUint32(at + 20, true)
		const uncompSize = view.getUint32(at + 24, true)
		const nameLen = view.getUint16(at + 28, true)
		const extraLen = view.getUint16(at + 30, true)
		const commentLen = view.getUint16(at + 32, true)
		const localAt = view.getUint32(at + 42, true)
		const name = textDecode(buf.subarray(at + 46, at + 46 + nameLen))
		if (view.getUint32(localAt, true) !== LOCAL_SIG)
			throw new Error(`bad local header for ${name}`)
		const localNameLen = view.getUint16(localAt + 26, true)
		const localExtraLen = view.getUint16(localAt + 28, true)
		const dataAt = localAt + 30 + localNameLen + localExtraLen
		entries.push({
			name,
			method,
			crc,
			compSize,
			uncompSize,
			compData: buf.subarray(dataAt, dataAt + compSize),
		})
		at += 46 + nameLen + extraLen + commentLen
	}
	return entries
}

export async function inflateRaw(
	data: Uint8Array,
	size: number,
): Promise<Uint8Array> {
	const stream = new Blob([data as BlobPart])
		.stream()
		.pipeThrough(new DecompressionStream('deflate-raw'))
	const out = new Uint8Array(await new Response(stream).arrayBuffer())
	if (out.length !== size)
		throw new Error(`inflate size mismatch: ${out.length} != ${size}`)
	return out
}

export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([data as BlobPart])
		.stream()
		.pipeThrough(new CompressionStream('deflate-raw'))
	return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function entryData(entry: ZipEntry): Promise<Uint8Array> {
	if (entry.method === 0) return entry.compData
	if (entry.method === 8) return inflateRaw(entry.compData, entry.uncompSize)
	throw new Error(`unsupported compression method ${entry.method}`)
}

function padExtra(extra: Uint8Array, dataStart: number): Uint8Array {
	const aligned = (dataStart + extra.length + 4) % 4
	if (aligned === 0) return extra
	const pad = 4 - aligned
	const out = concat(extra, le16(0xd935), le16(pad), new Uint8Array(pad))
	return out
}

export async function writeZip(entries: ZipWriteEntry[]): Promise<Uint8Array> {
	const locals: Uint8Array[] = []
	const centrals: Uint8Array[] = []
	let offset = 0
	for (const entry of entries) {
		const name = textEncode(entry.name)
		let method: number = entry.method
		let comp = entry.data
		let crc = crc32(entry.data)
		let uncompSize = entry.data.length
		if (entry.raw) {
			method = entry.raw.method
			comp = entry.raw.compData
			crc = entry.raw.crc
			uncompSize = entry.raw.uncompSize
		} else if (method === 8) {
			const deflater = entry.deflate ?? deflateRaw
			comp = await deflater(entry.data)
			if (comp.length >= entry.data.length) {
				method = 0
				comp = entry.data
			}
		}
		const dataStart = offset + 30 + name.length
		const extra = padExtra(new Uint8Array(0), dataStart)
		const local = concat(
			le32(LOCAL_SIG),
			le16(20),
			le16(0),
			le16(method),
			le16(0),
			le16(0),
			le32(crc),
			le32(comp.length),
			le32(uncompSize),
			le16(name.length),
			le16(extra.length),
			name,
			extra,
			comp,
		)
		const central = concat(
			le32(CD_SIG),
			le16(20),
			le16(20),
			le16(0),
			le16(method),
			le16(0),
			le16(0),
			le32(crc),
			le32(comp.length),
			le32(uncompSize),
			le16(name.length),
			le16(0),
			le16(0),
			le16(0),
			le16(0),
			le32(0),
			le32(offset),
			name,
		)
		locals.push(local)
		centrals.push(central)
		offset += local.length
	}
	const cd = concat(...centrals)
	const eocd = concat(
		le32(EOCD_SIG),
		le16(0),
		le16(0),
		le16(entries.length),
		le16(entries.length),
		le32(cd.length),
		le32(offset),
		le16(0),
	)
	return concat(...locals, cd, eocd)
}

export function splitZip(buf: Uint8Array): {
	head: Uint8Array
	cd: Uint8Array
	eocd: Uint8Array
} {
	const view = new DataView(buf.buffer, buf.byteOffset)
	for (
		let at = buf.length - EOCD_MIN;
		at >= Math.max(0, buf.length - EOCD_MAX);
		at--
	) {
		if (view.getUint32(at, true) === EOCD_SIG) {
			const cdSize = view.getUint32(at + 12, true)
			const cdAt = view.getUint32(at + 16, true)
			return {
				head: buf.subarray(0, cdAt),
				cd: buf.subarray(cdAt, cdAt + cdSize),
				eocd: buf.subarray(at),
			}
		}
	}
	throw new Error('not a zip: end of central directory missing')
}

export function withCdOffset(buf: Uint8Array, cdOffset: number): Uint8Array {
	const out = buf.slice()
	new DataView(out.buffer).setUint32(out.length - 6, cdOffset, true)
	return out
}
