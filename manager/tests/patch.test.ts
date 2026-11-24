import { expect, test } from 'bun:test'
import {
	findPattern,
	parsePattern,
	renameNeeded,
	replacePattern,
	runPack,
} from '../src/patch.ts'
import { equalBytes, hex, textEncode } from '../src/util.ts'
import { axmlDoc, elf64 } from './fixtures'
import type { PatchPack } from '../src/patch.ts'

test('patterns support wildcards', () => {
	const data = new Uint8Array([
		0x48, 0x89, 0xe5, 0x48, 0x8b, 0x00, 0x48, 0x89, 0xdd, 0x48, 0x8b, 0x01,
	])
	const pattern = parsePattern('48 89 ?? 48 8b')
	expect(findPattern(data, pattern)).toEqual([0, 6])
})

test('replace keeps wildcard bytes and counts matches', () => {
	const data = new Uint8Array([0x48, 0x89, 0xe5, 0x48, 0x8b, 0xff])
	const { data: out, count } = replacePattern(
		data,
		'48 89 ?? 48 8b',
		'48 87 ?? 48 8b',
	)
	expect(count).toBe(1)
	expect(hex(out)).toBe('4887e5488bff')
})

test('replace enforces same length', () => {
	expect(() => replacePattern(new Uint8Array(8), '01 02', '01')).toThrow()
})

test('rename_needed rewrites only full entries in the string table', () => {
	const elf = elf64(256, ['libc.so', 'mylog.so', 'liblog.so', 'libz.so'], 384)
	const { data, count } = renameNeeded(elf, 'liblog.so', 'libvld.so')
	expect(count).toBe(1)
	expect(hex(data).includes(hex(textEncode('mylog.so')))).toBe(true)
	expect(hex(data).includes(hex(textEncode('libvld.so')))).toBe(true)
	expect(hex(data).includes(hex(textEncode('liblog.so')))).toBe(false)
})

test('rename_needed skips substrings inside longer entries', () => {
	const elf = elf64(256, ['xliblog.so'], 384)
	const { data, count } = renameNeeded(elf, 'liblog.so', 'libvld.so')
	expect(count).toBe(0)
	expect(hex(data).includes(hex(textEncode('xliblog.so')))).toBe(true)
})

test('rename_needed refuses different lengths', () => {
	const elf = elf64(256, ['liblog.so'], 384)
	expect(() =>
		renameNeeded(elf, 'liblog.so', 'libvalenced_loader.so'),
	).toThrow()
})

test('runPack enforces expect counts', () => {
	const doc = axmlDoc(['com.discord.release', 'other'], true)
	const files = new Map([['AndroidManifest.xml', doc]])
	const pack: PatchPack = {
		format: 1,
		id: 'example',
		steps: [
			{
				file: 'AndroidManifest.xml',
				op: 'replace',
				pattern: '63 6f 6d 00',
				with: '63 6f 6d 00',
				expect: 0,
			},
			{ file: 'AndroidManifest.xml', op: 'assert', text: 'other', expect: 1 },
			{ file: 'missing.bin', op: 'assert', text: 'x', expect: 1 },
		],
	}
	const log = runPack(files, pack)
	expect(log[0].ok).toBe(true)
	expect(log[1].ok).toBe(true)
	expect(log[2].ok).toBe(false)
})

test('assert fails when the count is off', () => {
	const files = new Map([['a.bin', new Uint8Array([1, 2, 3, 4])]])
	const log = runPack(files, {
		format: 1,
		id: 't',
		steps: [{ file: 'a.bin', op: 'assert', contains: '09', expect: 1 }],
	})
	expect(log[0].ok).toBe(false)
	expect(log[0].message).toContain('expected 1')
})

test('bad packs are rejected', () => {
	expect(() => runPack(new Map(), { format: 2, id: 'x', steps: [] })).toThrow()
	expect(() =>
		runPack(new Map(), {
			format: 1,
			id: 'x',
			steps: [{ file: 'f', op: 'nope' as never }],
		}),
	).toThrow()
})

test('elf parsing rejects non elf data', () => {
	expect(() => renameNeeded(new Uint8Array(64), 'a.so', 'b.so')).toThrow()
	expect(() =>
		renameNeeded(elf64(256, ['a'], 384).subarray(0, 32), 'a', 'b'),
	).toThrow()
})

test('equalBytes helper sanity', () => {
	expect(equalBytes(textEncode('ab'), textEncode('ab'))).toBe(true)
})
