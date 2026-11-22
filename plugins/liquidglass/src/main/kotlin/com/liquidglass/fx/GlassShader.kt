package com.liquidglass.fx

internal object GlassShader {
	const val SOURCE = """
		uniform shader content;
		uniform float2 viewSize;
		uniform float2 halfBox;
		uniform float radius;
		uniform float bevel;
		uniform float refractPx;
		uniform float falloff;
		uniform float dispersion;
		uniform float2 lightDir;
		uniform float specStrength;
		uniform float rimBand;
		uniform float4 tintColor;
		uniform float adaptiveTint;
		uniform float dimAmount;
		uniform float satFactor;

		float sdBox(float2 p, float2 b, float r) {
			float2 q = abs(p) - b + r;
			return length(max(q, float2(0.0))) + min(max(q.x, q.y), 0.0) - r;
		}

		float shape(float2 p) {
			return sdBox(p - viewSize * 0.5, halfBox, radius);
		}

		half4 main(float2 coord) {
			if (coord.x < 0.0 || coord.y < 0.0 || coord.x > viewSize.x || coord.y > viewSize.y) {
				return half4(0.0);
			}
			float d = shape(coord);
			float cov = clamp(0.5 - d / 1.5, 0.0, 1.0);
			if (cov <= 0.004) {
				return half4(0.0);
			}
			float2 n = float2(
				shape(coord + float2(1.0, 0.0)) - shape(coord - float2(1.0, 0.0)),
				shape(coord + float2(0.0, 1.0)) - shape(coord - float2(0.0, 1.0))
			);
			float nLen = length(n);
			if (nLen > 0.0001) {
				n = n / nLen;
			} else {
				n = float2(0.0, -1.0);
			}
			float t = clamp(-d / max(bevel, 1.0), 0.0, 1.0);
			float edge = 1.0 - t;
			float slope;
			if (falloff > 0.001) {
				float gB = pow(5.0, -falloff);
				slope = (pow(1.0 + 4.0 * t, -falloff) - gB) / (1.0 - gB);
			} else {
				slope = edge * edge;
			}
			float2 offset = -n * (slope * refractPx);
			float2 cR = clamp(coord + offset * (1.0 - dispersion * slope), float2(0.0), viewSize);
			float2 cG = clamp(coord + offset, float2(0.0), viewSize);
			float2 cB = clamp(coord + offset * (1.0 + dispersion * slope), float2(0.0), viewSize);
			float3 col = float3(content.eval(cR).r, content.eval(cG).g, content.eval(cB).b);
			float lum = dot(col, float3(0.2126, 0.7152, 0.0722));
			if (satFactor <= 1.0) {
				col = mix(float3(lum), col, satFactor);
			} else {
				float satNow = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
				float room = 1.0 - smoothstep(0.2, 0.85, satNow);
				float hl = 1.0 - smoothstep(0.75, 0.98, lum);
				float amount = 1.0 + (satFactor - 1.0) * mix(0.3, 1.0, room * hl);
				col = clamp(mix(float3(lum), col, amount), float3(0.0), float3(1.0));
			}
			if (adaptiveTint > 0.5) {
				float lumT = dot(col, float3(0.2126, 0.7152, 0.0722));
				float e = smoothstep(0.35, 0.75, lumT);
				col = mix(col, float3(1.0 - e), 0.14 + 0.08 * e);
			} else {
				col = mix(col, tintColor.rgb, tintColor.a);
			}
			col = col * (1.0 - dimAmount);
			float facing = dot(n, -lightDir);
			float lobeF = pow(max(facing, 0.0), 4.5);
			float lobeB = pow(max(-facing, 0.0), 4.5);
			float bandW = clamp(bevel * 0.3, 2.0, rimBand);
			float glowIn = clamp((-d - 1.0) / 2.0, 0.0, 1.0);
			float glow = glowIn * pow(clamp(1.0 - (-d - 3.0) / bandW, 0.0, 1.0), 1.5) * cov;
			float hair = clamp(1.0 - abs(d + 1.0) / 2.0, 0.0, 1.0) * cov;
			float spec = (hair * 0.70 * (lobeF + lobeB) + glow * 0.10 * lobeF) * specStrength;
			col += float3(spec);
			col = clamp(col, float3(0.0), float3(1.0));
			return half4(half3(col * cov), half(cov));
		}
	"""
}
