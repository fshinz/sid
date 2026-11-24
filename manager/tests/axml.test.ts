import { expect, test } from 'bun:test'
import {
	findString,
	isBinaryXml,
	listStrings,
	replaceString,
	replaceValue,
} from '../src/axml.ts'
import { textDecode } from '../src/util.ts'
import { axmlDoc } from './fixtures'

test('lists strings in both encodings', () => {
	for (const utf8 of [true, false]) {
		const doc = axmlDoc(['com.discord.release', 'label', 'фыва'], utf8)
		expect(isBinaryXml(doc)).toBe(true)
		expect(listStrings(doc)).toEqual(['com.discord.release', 'label', 'фыва'])
	}
})

test('replaceString handles shorter and longer values', () => {
	const doc = axmlDoc(['com.discord.release', 'keep'], true)
	const shorter = replaceValue(doc, 'com.discord.release', 'dev.valenced.pnx')
	expect(listStrings(shorter)).toEqual(['dev.valenced.pnx', 'keep'])
	const longer = replaceValue(
		doc,
		'com.discord.release',
		'dev.valenced.phoenix.beta',
	)
	expect(listStrings(longer)).toEqual(['dev.valenced.phoenix.beta', 'keep'])
})

test('replace keeps the trailing chunk intact', () => {
	const doc = axmlDoc(['alpha'], false)
	const out = replaceString(doc, 0, 'b')
	expect(textDecode(out.subarray(out.length - 8))).toBe(
		textDecode(doc.subarray(doc.length - 8)),
	)
	expect(out.length).toBeLessThan(doc.length + 8)
	expect(findString(out, 'b')).toBe(0)
})

test('missing values and bad indexes throw', () => {
	const doc = axmlDoc(['only'], true)
	expect(findString(doc, 'nope')).toBe(-1)
	expect(() => replaceValue(doc, 'nope', 'x')).toThrow()
	expect(() => replaceString(doc, 5, 'x')).toThrow()
	expect(isBinaryXml(new Uint8Array([1, 2, 3]))).toBe(false)
})
