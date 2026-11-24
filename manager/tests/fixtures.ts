import { concat, le16, le32, textEncode } from '../src/util.ts'

export function axmlDoc(strings: string[], utf8 = true): Uint8Array {
	const encoded = strings.map(value => encodePoolString(value, utf8))
	const offsets: Uint8Array[] = []
	let running = 0
	for (const chunk of encoded) {
		offsets.push(le32(running))
		running += chunk.length
	}
	const data = concat(...encoded)
	const stringsStart = 28 + strings.length * 4
	const poolSize = stringsStart + data.length
	const pool = concat(
		le16(0x0001),
		le16(16),
		le32(poolSize),
		le32(strings.length),
		le32(0),
		le32(utf8 ? 0x100 : 0),
		le32(stringsStart),
		le32(0),
		...offsets,
		data,
	)
	const tail = concat(le16(0x0102), le16(8), le32(8))
	return concat(
		le16(0x0003),
		le16(8),
		le32(8 + poolSize + tail.length),
		pool,
		tail,
	)
}

export function encodePoolString(value: string, utf8: boolean): Uint8Array {
	if (!utf8) {
		const units = [...value].map(ch => ch.codePointAt(0) as number)
		const out = new Uint8Array(2 + units.length * 2 + 2)
		out.set([units.length & 0xff, units.length >> 8], 0)
		const view = new DataView(out.buffer)
		units.forEach((unit, i) => view.setUint16(2 + i * 2, unit, true))
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

export function elf64(
	strtabOffset: number,
	strtab: string[],
	dynOffset: number,
): Uint8Array {
	const strtabBytes = concat(
		...strtab.map(name => concat(textEncode(name), new Uint8Array([0]))),
	)
	const total = Math.max(
		strtabOffset + strtabBytes.length,
		dynOffset + 16 * (strtab.length + 2),
		512,
	)
	const out = new Uint8Array(total)
	const view = new DataView(out.buffer)
	out.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0)
	view.setUint16(16, 2, true)
	view.setUint16(18, 0x3e, true)
	view.setUint32(20, 1, true)
	view.setBigUint64(32, BigInt(64), true)
	view.setUint16(52, 64, true)
	view.setUint16(54, 56, true)
	view.setUint16(56, 2, true)
	const base = 0x10000
	view.setUint32(64, 1, true)
	view.setUint32(68, 5, true)
	view.setBigUint64(72, 0n, true)
	view.setBigUint64(80, BigInt(base), true)
	view.setBigUint64(88, BigInt(base), true)
	view.setBigUint64(96, BigInt(total), true)
	view.setBigUint64(104, BigInt(total), true)
	view.setBigUint64(112, 0x1000n, true)
	view.setUint32(120, 2, true)
	view.setUint32(124, 6, true)
	view.setBigUint64(128, BigInt(dynOffset), true)
	view.setBigUint64(136, BigInt(base + dynOffset), true)
	view.setBigUint64(144, BigInt(base + dynOffset), true)
	const dynEntries: Array<[number, number]> = [
		[5, base + strtabOffset],
		[10, strtabBytes.length],
		[1, 0],
		[0, 0],
	]
	view.setBigUint64(152, BigInt(dynEntries.length * 16), true)
	view.setBigUint64(160, BigInt(dynEntries.length * 16), true)
	dynEntries.forEach(([tag, val], i) => {
		view.setBigUint64(dynOffset + i * 16, BigInt(tag), true)
		view.setBigUint64(dynOffset + i * 16 + 8, BigInt(val), true)
	})
	out.set(strtabBytes, strtabOffset)
	return out
}
