export function concat(...parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((n, p) => n + p.length, 0)
	const out = new Uint8Array(total)
	let at = 0
	for (const p of parts) {
		out.set(p, at)
		at += p.length
	}
	return out
}

export function le16(n: number): Uint8Array {
	const b = new Uint8Array(2)
	new DataView(b.buffer).setUint16(0, n, true)
	return b
}

export function le32(n: number): Uint8Array {
	const b = new Uint8Array(4)
	new DataView(b.buffer).setUint32(0, n, true)
	return b
}

export function le64(n: number): Uint8Array {
	const b = new Uint8Array(8)
	new DataView(b.buffer).setBigUint64(0, BigInt(n), true)
	return b
}

export function readLe16(v: Uint8Array, at: number): number {
	return new DataView(v.buffer, v.byteOffset).getUint16(at, true)
}

export function readLe32(v: Uint8Array, at: number): number {
	return new DataView(v.buffer, v.byteOffset).getUint32(at, true)
}

const HEX = '0123456789abcdef'

export function hex(data: Uint8Array): string {
	let out = ''
	for (const b of data) out += HEX[b >> 4] + HEX[b & 15]
	return out
}

export function fromHex(text: string): Uint8Array {
	const clean = text.replace(/[\s_-]/g, '')
	if (clean.length % 2 !== 0) throw new Error('odd hex length')
	const out = new Uint8Array(clean.length / 2)
	for (let i = 0; i < out.length; i++) {
		const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
		if (Number.isNaN(byte)) throw new Error(`bad hex at ${i * 2}`)
		out[i] = byte
	}
	return out
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
	const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(data))
	return new Uint8Array(digest)
}

export async function sha256hex(data: Uint8Array): Promise<string> {
	return hex(await sha256(data))
}

export function toArrayBuffer(data: Uint8Array): ArrayBuffer {
	return data.buffer.slice(
		data.byteOffset,
		data.byteOffset + data.byteLength,
	) as ArrayBuffer
}

export function fmtSize(n: number): string {
	if (n < 1024) return `${n} B`
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
	if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
	return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		table[n] = c >>> 0
	}
	return table
})()

export function crc32(data: Uint8Array): number {
	let c = 0xffffffff
	for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}

export function textEncode(text: string): Uint8Array {
	return new TextEncoder().encode(text)
}

export function textDecode(data: Uint8Array): string {
	return new TextDecoder().decode(data)
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
	return true
}
