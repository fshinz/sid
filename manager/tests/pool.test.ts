import { expect, test } from 'bun:test'
import {
	parseIndex,
	pickChannel,
	pluginScriptName,
	verifyDist,
} from '../src/pool.ts'
import { textEncode } from '../src/util.ts'

const index = {
	format: 1,
	plugins: [
		{
			id: 'message-logger',
			version: '1.2.0',
			name: 'Message Logger',
			description: 'Keeps deleted messages',
			author: 'valenced',
			channels: {
				stable: { url: 'https://example.com/stable.js', size: 10, sha256: '' },
				canary: { url: 'https://example.com/canary.js', size: 11, sha256: '' },
			},
		},
	],
}

test('parses a valid index', () => {
	const parsed = parseIndex(index)
	expect(parsed.plugins.length).toBe(1)
	expect(pluginScriptName(parsed.plugins[0])).toBe('message-logger.js')
})

test('rejects bad indexes', () => {
	expect(() => parseIndex({ format: 2, plugins: [] })).toThrow()
	expect(() => parseIndex(null)).toThrow()
	expect(() => parseIndex({ format: 1, plugins: [{ id: 'x' }] })).toThrow()
})

test('channel picking prefers the request then falls back', () => {
	const [plugin] = parseIndex(index).plugins
	expect(pickChannel(plugin, 'canary')?.url).toBe(
		'https://example.com/canary.js',
	)
	expect(pickChannel(plugin, 'beta')?.url).toBe('https://example.com/stable.js')
	expect(pickChannel({ ...plugin, channels: {} }, 'stable')).toBeUndefined()
})

test('verifyDist enforces size and sha256', async () => {
	const data = textEncode('hello world')
	await verifyDist(data, { url: '', size: 11, sha256: '' })
	await expect(
		verifyDist(data, { url: '', size: 12, sha256: '' }),
	).rejects.toThrow('size')
	await expect(
		verifyDist(data, { url: '', size: 11, sha256: '00'.repeat(32) }),
	).rejects.toThrow('sha256')
})
