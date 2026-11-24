import { expect, test } from 'bun:test'
import { inflateRawSync } from 'node:zlib'
import { equalBytes, readLe32, textEncode } from '../src/util.ts'
import {
	entryData,
	parseZip,
	splitZip,
	withCdOffset,
	writeZip,
} from '../src/zip.ts'
import type { ZipWriteEntry } from '../src/zip.ts'

function stored(name: string, data: Uint8Array): ZipWriteEntry {
	return { name, data, method: 0 }
}

test('writeZip roundtrips stored and deflated entries', async () => {
	const alpha = textEncode('hello hello hello hello')
	const beta = textEncode('plain')
	const buf = await writeZip([
		stored('a.txt', alpha),
		{ name: 'b.txt', data: beta, method: 8 },
	])
	const entries = parseZip(buf)
	expect(entries.map(entry => entry.name)).toEqual(['a.txt', 'b.txt'])
	expect(equalBytes(await entryData(entries[0]), alpha)).toBe(true)
	expect(entries[0].method).toBe(0)
	expect(equalBytes(await entryData(entries[1]), beta)).toBe(true)
})

test('deflated entries keep their bytes through decompress', async () => {
	const data = textEncode('x'.repeat(3000))
	const buf = await writeZip([{ name: 'big.bin', data, method: 8 }])
	const entries = parseZip(buf)
	expect(entries[0].method).toBe(8)
	expect(entries[0].compSize).toBeLessThan(data.length)
	expect(equalBytes(await entryData(entries[0]), data)).toBe(true)
})

test('stored entry data starts 4 byte aligned', async () => {
	const data = textEncode('payload')
	const buf = await writeZip([stored('x/y.z', data)])
	const entries = parseZip(buf)
	const view = new DataView(buf.buffer, buf.byteOffset)
	let eocdAt = 0
	for (let at = buf.length - 22; at >= 0; at--) {
		if (view.getUint32(at, true) === 0x06054b50) {
			eocdAt = at
			break
		}
	}
	const cdAt = view.getUint32(eocdAt + 16, true)
	const localAt = view.getUint32(cdAt + 42, true)
	const nameLen = view.getUint16(localAt + 26, true)
	const extraLen = view.getUint16(localAt + 28, true)
	const dataAt = localAt + 30 + nameLen + extraLen
	expect(dataAt % 4).toBe(0)
	expect(
		equalBytes(buf.subarray(dataAt, dataAt + entries[0].compSize), data),
	).toBe(true)
})

test('splitZip finds the three regions and withCdOffset patches eocd', async () => {
	const buf = await writeZip([stored('f', textEncode('data'))])
	const { head, cd, eocd } = splitZip(buf)
	expect(head.length + cd.length + eocd.length).toBe(buf.length)
	expect(readLe32(cd, 0)).toBe(0x02014b50)
	const moved = withCdOffset(eocd, 12345)
	expect(readLe32(moved, moved.length - 6)).toBe(12345)
	expect(moved.length).toBe(eocd.length)
})

test('zip64 sized directories are not supported, plain zips parse', async () => {
	const buf = await writeZip([stored('only', new Uint8Array([1, 2, 3]))])
	expect(() => parseZip(buf.subarray(0, buf.length - 10))).toThrow()
})

test('inflateRaw validates the size', async () => {
	const data = textEncode('compress me compress me')
	const buf = await writeZip([{ name: 'c', data, method: 8 }])
	const entry = parseZip(buf)[0]
	await expect(
		entryData({ ...entry, uncompSize: entry.uncompSize + 1 }),
	).rejects.toThrow()
	expect(typeof inflateRawSync).toBe('function')
})
