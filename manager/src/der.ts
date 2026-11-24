import { concat, textEncode } from './util.ts'

function tlv(tag: number, body: Uint8Array): Uint8Array {
	return concat(new Uint8Array([tag]), length(body.length), body)
}

function length(n: number): Uint8Array {
	if (n < 0x80) return new Uint8Array([n])
	if (n < 0x100) return new Uint8Array([0x81, n])
	if (n < 0x10000) return new Uint8Array([0x82, n >> 8, n & 0xff])
	return new Uint8Array([0x83, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff])
}

export function derSequence(...parts: Uint8Array[]): Uint8Array {
	return tlv(0x30, concat(...parts))
}

export function derSet(...parts: Uint8Array[]): Uint8Array {
	return tlv(0x31, concat(...parts))
}

export function derInteger(bytes: Uint8Array): Uint8Array {
	let body = bytes
	while (body.length > 1 && body[0] === 0 && !(body[1] & 0x80))
		body = body.subarray(1)
	if (body[0] & 0x80) body = concat(new Uint8Array([0]), body)
	return tlv(0x02, body)
}

export function derOid(oid: string): Uint8Array {
	const parts = oid.split('.').map(Number)
	const body = [40 * parts[0] + parts[1]]
	for (const part of parts.slice(2)) {
		const stack: number[] = []
		let value = part
		do {
			stack.push(value & 0x7f)
			value >>= 7
		} while (value > 0)
		for (let i = stack.length - 1; i > 0; i--) body.push(0x80 | stack[i])
		body.push(stack[0])
	}
	return tlv(0x06, new Uint8Array(body))
}

export function derNull(): Uint8Array {
	return new Uint8Array([0x05, 0x00])
}

export function derBitString(bytes: Uint8Array): Uint8Array {
	return tlv(0x03, concat(new Uint8Array([0]), bytes))
}

export function derPrintable(text: string): Uint8Array {
	return tlv(0x13, textEncode(text))
}

export function derUtcTime(text: string): Uint8Array {
	return tlv(0x17, textEncode(text))
}

export const OID_RSA_ENCRYPTION = '1.2.840.113549.1.1.1'
export const OID_SHA256_WITH_RSA = '1.2.840.113549.1.1.11'
export const OID_COMMON_NAME = '2.5.4.3'

export function nameCn(value: string): Uint8Array {
	return derSequence(
		derSet(derSequence(derOid(OID_COMMON_NAME), derPrintable(value))),
	)
}

export function algorithmSha256WithRsa(): Uint8Array {
	return derSequence(derOid(OID_SHA256_WITH_RSA), derNull())
}

export function algorithmRsa(): Uint8Array {
	return derSequence(derOid(OID_RSA_ENCRYPTION), derNull())
}

export function derVersion(v: number): Uint8Array {
	return tlv(0xa0, derInteger(new Uint8Array([v])))
}
