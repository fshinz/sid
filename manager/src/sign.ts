import {
	algorithmSha256WithRsa,
	derBitString,
	derInteger,
	derSequence,
	derUtcTime,
	derVersion,
	nameCn,
} from './der.ts'
import { concat, hex, le32, le64, sha256, toArrayBuffer } from './util.ts'
import { splitZip, withCdOffset } from './zip.ts'

const SIG_ALG = 0x0103
const V3_BLOCK_ID = 0xf05368c0
const SIG_BLOCK_MAGIC = new TextEncoder().encode('APK Sig Block 42')
const CHUNK = 1024 * 1024

function lengthPrefixed(body: Uint8Array): Uint8Array {
	return concat(le32(body.length), body)
}

function pairs(items: Array<[number, Uint8Array]>): Uint8Array {
	return concat(
		...items.map(([id, body]) => concat(le32(id), lengthPrefixed(body))),
	)
}

export interface Signer {
	key: CryptoKeyPair
	cert: Uint8Array
}

export async function generateSigner(
	commonName = 'Valenced Manager',
): Promise<Signer> {
	const key = (await crypto.subtle.generateKey(
		{
			name: 'RSASSA-PKCS1-v1_5',
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: 'SHA-256',
		},
		true,
		['sign', 'verify'],
	)) as CryptoKeyPair
	return { key, cert: await selfSignedCert(key, commonName) }
}

function derSerial(): Uint8Array {
	const bytes = new Uint8Array(16)
	crypto.getRandomValues(bytes)
	bytes[0] &= 0x7f
	return derInteger(bytes)
}

function utcNow(offsetYears: number): string {
	const date = new Date()
	date.setFullYear(date.getFullYear() + offsetYears)
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${String(date.getUTCFullYear()).slice(2)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
}

export async function selfSignedCert(
	key: CryptoKeyPair,
	commonName: string,
): Promise<Uint8Array> {
	const spki = new Uint8Array(
		await crypto.subtle.exportKey('spki', key.publicKey),
	)
	const issuer = nameCn(commonName)
	const tbs = derSequence(
		derVersion(0),
		derSerial(),
		algorithmSha256WithRsa(),
		issuer,
		derSequence(derUtcTime(utcNow(-1)), derUtcTime(utcNow(10))),
		issuer,
		spki,
	)
	const signature = new Uint8Array(
		await crypto.subtle.sign(
			'RSASSA-PKCS1-v1_5',
			key.privateKey,
			toArrayBuffer(tbs),
		),
	)
	return derSequence(tbs, algorithmSha256WithRsa(), derBitString(signature))
}

async function digestChunk(chunk: Uint8Array): Promise<Uint8Array> {
	const input = concat(new Uint8Array([0xa5]), le32(chunk.length), chunk)
	return new Uint8Array(
		await crypto.subtle.digest('SHA-256', toArrayBuffer(input)),
	)
}

export async function chunkedDigest(
	segments: Uint8Array[],
): Promise<Uint8Array> {
	const chunkDigests: Uint8Array[] = []
	for (const segment of segments) {
		for (let at = 0; at < segment.length; at += CHUNK) {
			chunkDigests.push(
				await digestChunk(
					segment.subarray(at, Math.min(at + CHUNK, segment.length)),
				),
			)
		}
	}
	const wrap = concat(
		new Uint8Array([0x5a]),
		le32(chunkDigests.length),
		...chunkDigests,
	)
	return new Uint8Array(
		await crypto.subtle.digest('SHA-256', toArrayBuffer(wrap)),
	)
}

export interface SignResult {
	apk: Uint8Array
	blockSize: number
	digestHex: string
}

export async function signV3(
	unsigned: Uint8Array,
	signer: Signer,
	minSdk = 0,
	maxSdk = 0x7fffffff,
): Promise<SignResult> {
	const { head, cd, eocd } = splitZip(unsigned)
	const digest = await chunkedDigest([
		head,
		cd,
		withCdOffset(eocd, head.length),
	])
	const signedData = concat(
		lengthPrefixed(pairs([[SIG_ALG, digest]])),
		lengthPrefixed(lengthPrefixed(signer.cert)),
		le32(minSdk),
		le32(maxSdk),
		le32(0),
	)
	const signature = new Uint8Array(
		await crypto.subtle.sign(
			'RSASSA-PKCS1-v1_5',
			signer.key.privateKey,
			toArrayBuffer(signedData),
		),
	)
	const spki = new Uint8Array(
		await crypto.subtle.exportKey('spki', signer.key.publicKey),
	)
	const signerBlock = concat(
		lengthPrefixed(signedData),
		le32(minSdk),
		le32(maxSdk),
		lengthPrefixed(pairs([[SIG_ALG, signature]])),
		lengthPrefixed(spki),
	)
	const value = concat(
		le32(signerBlock.length + 4),
		lengthPrefixed(signerBlock),
	)
	const pair = concat(le64(4 + value.length), le32(V3_BLOCK_ID), value)
	const block = concat(
		le64(pair.length + 24),
		pair,
		le64(pair.length + 24),
		SIG_BLOCK_MAGIC,
	)
	const apk = concat(
		head,
		block,
		cd,
		withCdOffset(eocd, head.length + block.length),
	)
	return { apk, blockSize: block.length, digestHex: hex(digest) }
}

interface Tlv {
	tag: number
	body: Uint8Array
}

function tlvReader(data: Uint8Array) {
	const view = new DataView(data.buffer, data.byteOffset)
	let at = 0
	const readLength = (): number => {
		const first = view.getUint8(at++)
		if (first < 0x80) return first
		let value = 0
		for (let i = 0; i < (first & 0x7f); i++)
			value = (value << 8) | view.getUint8(at++)
		return value
	}
	return {
		next(): Tlv {
			const tag = view.getUint8(at++)
			const len = readLength()
			const body = data.subarray(at, at + len)
			at += len
			return { tag, body }
		},
	}
}

function encodeTlv(tag: number, body: Uint8Array): Uint8Array {
	const head = [tag]
	const len = body.length
	if (len < 0x80) head.push(len)
	else if (len < 0x100) head.push(0x81, len)
	else head.push(0x82, len >> 8, len & 0xff)
	return concat(new Uint8Array(head), body)
}

export function extractSpki(cert: Uint8Array): Uint8Array {
	const top = tlvReader(cert).next()
	if (top.tag !== 0x30) throw new Error('not a certificate')
	const fields = tlvReader(top.body)
	const tbs = fields.next()
	if (tbs.tag !== 0x30) throw new Error('bad certificate body')
	const inner = tlvReader(tbs.body)
	let field = inner.next()
	if (field.tag === 0xa0) field = inner.next()
	for (let skip = 0; skip < 5; skip++) field = inner.next()
	if (field.tag !== 0x30) throw new Error('subject public key info missing')
	return encodeTlv(0x30, field.body)
}

export interface ParsedSigner {
	signedData: Uint8Array
	minSdk: number
	maxSdk: number
	signature: Uint8Array
	publicKey: Uint8Array
}

export function parseSigner(value: Uint8Array): ParsedSigner {
	const view = new DataView(value.buffer, value.byteOffset)
	const signerLen = view.getUint32(4, true)
	const signer = value.subarray(8, 8 + signerLen)
	const sv = new DataView(signer.buffer, signer.byteOffset)
	const sdLen = sv.getUint32(0, true)
	const signedData = signer.subarray(4, 4 + sdLen)
	const minSdk = sv.getUint32(4 + sdLen, true)
	const maxSdk = sv.getUint32(8 + sdLen, true)
	let at = 12 + sdLen
	const sigsLen = sv.getUint32(at, true)
	const sigs = signer.subarray(at + 4, at + 4 + sigsLen)
	at += 4 + sigsLen
	const pkLen = sv.getUint32(at, true)
	const publicKey = signer.subarray(at + 4, at + 4 + pkLen)
	const sigv = new DataView(sigs.buffer, sigs.byteOffset)
	const alg = sigv.getUint32(0, true)
	if (alg !== SIG_ALG) throw new Error('unsupported signature algorithm')
	const sigLen = sigv.getUint32(4, true)
	return {
		signedData,
		minSdk,
		maxSdk,
		signature: sigs.subarray(8, 8 + sigLen),
		publicKey,
	}
}

export function parseSigningBlock(
	apk: Uint8Array,
): { pairId: number; value: Uint8Array; start: number } | undefined {
	const { head } = splitZip(apk)
	if (head.length < 40) return undefined
	if (hex(head.subarray(head.length - 16)) !== hex(SIG_BLOCK_MAGIC))
		return undefined
	const view = new DataView(head.buffer, head.byteOffset)
	const size = Number(view.getBigUint64(head.length - 24, true))
	const start = head.length - 8 - size
	const pairSize = Number(view.getBigUint64(start + 8, true))
	return {
		pairId: view.getUint32(start + 16, true),
		value: head.subarray(start + 20, start + 16 + pairSize),
		start,
	}
}

export function parseSignedDigest(signedData: Uint8Array): Uint8Array {
	const view = new DataView(signedData.buffer, signedData.byteOffset)
	const pairsLen = view.getUint32(0, true)
	const pairs = signedData.subarray(4, 4 + pairsLen)
	const alg = new DataView(pairs.buffer, pairs.byteOffset).getUint32(0, true)
	if (alg !== SIG_ALG) throw new Error('unsupported digest algorithm')
	const len = new DataView(pairs.buffer, pairs.byteOffset).getUint32(4, true)
	return pairs.subarray(8, 8 + len)
}

export async function verifyV3(
	apk: Uint8Array,
	cert: Uint8Array,
): Promise<boolean> {
	const found = parseSigningBlock(apk)
	if (!found || found.pairId !== V3_BLOCK_ID) return false
	const { signedData, signature, publicKey } = parseSigner(found.value)
	const spki = extractSpki(cert)
	if (hex(spki) !== hex(publicKey)) return false
	const key = await crypto.subtle.importKey(
		'spki',
		toArrayBuffer(spki),
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['verify'],
	)
	const signatureOk = await crypto.subtle.verify(
		'RSASSA-PKCS1-v1_5',
		key,
		toArrayBuffer(signature),
		toArrayBuffer(signedData),
	)
	if (!signatureOk) return false
	const { head, cd, eocd } = splitZip(apk)
	const digest = await chunkedDigest([
		head.subarray(0, found.start),
		cd,
		withCdOffset(eocd, found.start),
	])
	return hex(digest) === hex(parseSignedDigest(signedData))
}

export async function certFingerprint(cert: Uint8Array): Promise<string> {
	return hex(await sha256(cert))
}

export async function pemSpki(key: CryptoKeyPair): Promise<string> {
	const raw = new Uint8Array(
		await crypto.subtle.exportKey('spki', key.publicKey),
	)
	return wrapPem('PUBLIC KEY', raw)
}

export async function pemPkcs8(key: CryptoKeyPair): Promise<string> {
	const raw = new Uint8Array(
		await crypto.subtle.exportKey('pkcs8', key.privateKey),
	)
	return wrapPem('PRIVATE KEY', raw)
}

function wrapPem(label: string, raw: Uint8Array): string {
	const body = btoa(String.fromCharCode(...raw)).replace(/(.{64})/g, '$1\n')
	return `-----BEGIN ${label}-----\n${body}${body.endsWith('\n') ? '' : '\n'}-----END ${label}-----\n`
}
