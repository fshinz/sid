import { expect, test } from 'bun:test'
import {
	crc32,
	equalBytes,
	fromHex,
	hex,
	sha256hex,
	textEncode,
} from '../src/util.ts'

test('hex roundtrips', () => {
	const data = new Uint8Array([0, 1, 0xab, 0xff])
	expect(hex(data)).toBe('0001abff')
	expect(equalBytes(fromHex('00 01 ab ff'), data)).toBe(true)
})

test('fromHex rejects bad input', () => {
	expect(() => fromHex('abc')).toThrow()
	expect(() => fromHex('zz')).toThrow()
})

test('crc32 known vector', () => {
	expect(crc32(textEncode('123456789'))).toBe(0xcbf43926)
})

test('sha256 known vector', async () => {
	expect(await sha256hex(new Uint8Array(0))).toBe(
		'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	)
})
