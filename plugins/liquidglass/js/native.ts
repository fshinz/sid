import { callNativeMethod } from '@valenced/modules/native'

export type GlassMaterial = 'regular' | 'clear'

export type GlassState = {
	enabled: boolean
	top: boolean
	bottom: boolean
	input: boolean
	floating: boolean
	material: GlassMaterial
	preset: string
	blurDp: number
	bevelDp: number
	refractDp: number
	falloff: number
	dispersion: number
	rim: number
	dim: number
	sat: number
	tint: number
	sensor: boolean
}

export type AppliedSurface = {
	target: string
	class: string
	x: number
	y: number
	width: number
	height: number
}

export type GlassStatus = {
	enabled: boolean
	path: string
	material: string
	sensor: boolean
	applied: AppliedSurface[]
}

const PREFIX = 'com.liquidglass.fx'
const call = callNativeMethod as (
	name: string,
	args: unknown[],
) => Promise<unknown>

export function pushConfig(state: GlassState): Promise<unknown> {
	return call(`${PREFIX}.configure`, [state])
}

export function applyNow(): Promise<unknown> {
	return call(`${PREFIX}.apply`, [])
}

export function clearAll(): Promise<unknown> {
	return call(`${PREFIX}.clear`, [])
}

export function readStatus(): Promise<GlassStatus> {
	return call(`${PREFIX}.status`, []) as Promise<GlassStatus>
}
