import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
	certFingerprint,
	chunkedDigest,
	extractSpki,
	generateSigner,
	parseSignedDigest,
	parseSigner,
	parseSigningBlock,
	signV3,
	verifyV3,
} from '../src/sign.ts'
import { concat, equalBytes, hex, le32, toArrayBuffer } from '../src/util.ts'
import { writeZip } from '../src/zip.ts'

const CHUNK = 1024 * 1024

function refChunkedDigest(segments: Uint8Array[]): Uint8Array {
	const chunks: Uint8Array[] = []
	for (const segment of segments) {
		for (let at = 0; at < segment.length; at += CHUNK)
			chunks.push(segment.subarray(at, Math.min(at + CHUNK, segment.length)))
	}
	const chunkDigests = chunks.map(chunk =>
		createHash('sha256')
			.update(Buffer.from([0xa5]))
			.update(Buffer.from(le32(chunk.length)))
			.update(Buffer.from(chunk))
			.digest(),
	)
	return new Uint8Array(
		createHash('sha256')
			.update(Buffer.from([0x5a]))
			.update(Buffer.from(le32(chunks.length)))
			.update(Buffer.concat(chunkDigests))
			.digest(),
	)
}

test('chunked digest matches an independent implementation', async () => {
	const cases: Uint8Array[][] = [
		[],
		[new Uint8Array(0)],
		[new Uint8Array(5)],
		[new Uint8Array(CHUNK), new Uint8Array(10)],
		[new Uint8Array(CHUNK + 1)],
		[
			new Uint8Array(300).fill(7),
			new Uint8Array(400).fill(8),
			new Uint8Array(0),
		],
	]
	for (const segments of cases) {
		const ours = await chunkedDigest(segments)
		expect(hex(ours)).toBe(hex(refChunkedDigest(segments)))
	}
})

test('certificate matches its public key', async () => {
	const signer = await generateSigner('Test')
	const spki = new Uint8Array(
		await crypto.subtle.exportKey('spki', signer.key.publicKey),
	)
	expect(equalBytes(extractSpki(signer.cert), spki)).toBe(true)
	expect((await certFingerprint(signer.cert)).length).toBe(64)
})

test('signed apk verifies and survives tamper checks', async () => {
	const unsigned = await writeZip([
		{ name: 'AndroidManifest.xml', data: new Uint8Array([1, 2, 3]), method: 0 },
		{
			name: 'lib/arm64-v8a/liblog.so',
			data: new Uint8Array(2000).fill(9),
			method: 8,
		},
	])
	const signer = await generateSigner('Test')
	const { apk, blockSize } = await signV3(unsigned, signer, 26, 35)
	expect(blockSize).toBeGreaterThan(1000)
	expect(apk.length).toBe(unsigned.length + blockSize)
	expect(await verifyV3(apk, signer.cert)).toBe(true)

	const found = parseSigningBlock(apk)
	expect(found?.pairId).toBe(0xf05368c0)
	const parsed = parseSigner((found as { value: Uint8Array }).value)
	expect(parsed.minSdk).toBe(26)
	expect(parsed.maxSdk).toBe(35)
	expect(
		equalBytes(
			parseSignedDigest(parsed.signedData).subarray(0, 0),
			new Uint8Array(0),
		),
	).toBe(true)

	const tampered = apk.slice()
	tampered[10] ^= 0xff
	expect(await verifyV3(tampered, signer.cert)).toBe(false)

	const other = await generateSigner('Other')
	expect(await verifyV3(apk, other.cert)).toBe(false)
})

test('signer wrap keeps both length levels', async () => {
	const unsigned = await writeZip([
		{ name: 'a', data: new Uint8Array([1]), method: 0 },
	])
	const signer = await generateSigner('Test')
	const { apk } = await signV3(unsigned, signer)
	const found = parseSigningBlock(apk)
	const value = (found as { value: Uint8Array }).value
	const view = new DataView(value.buffer, value.byteOffset)
	const outer = view.getUint32(0, true)
	expect(outer).toBe(value.length - 4)
	const inner = view.getUint32(4, true)
	expect(4 + inner).toBe(outer)
})

test('toArrayBuffer copies safely', () => {
	const big = new Uint8Array([1, 2, 3, 4, 5])
	const part = big.subarray(1, 4)
	const copy = toArrayBuffer(part)
	expect(new Uint8Array(copy).length).toBe(3)
	expect(concat(part, part).length).toBe(6)
})
