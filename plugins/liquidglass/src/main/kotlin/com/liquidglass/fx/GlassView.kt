package com.liquidglass.fx

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build
import android.view.View

internal data class GlassParams(
	val radiusPx: Float,
	val extendX: Float,
	val extendY: Float,
	val bevelPx: Float,
	val refractPx: Float,
	val falloff: Float,
	val dispersion: Float,
	val rim: Float,
	val dim: Float,
	val sat: Float,
	val adaptive: Boolean,
	val tintColor: Int,
	val tintColorAlpha: Float,
) {
	fun signature(): String =
		"$radiusPx|$extendX|$extendY|$bevelPx|$refractPx|$falloff|$dispersion|$rim|$dim|$sat|$adaptive|$tintColor|$tintColorAlpha"
}

internal class GlassView(context: Context, private val engine: GlassEngine, var params: GlassParams) : View(context) {
	private val bitmapPaint = Paint(Paint.FILTER_BITMAP_FLAG)
	private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
	private val rimPaint = Paint(Paint.ANTI_ALIAS_FLAG)
	private val effectPaint = Paint()
	private var runtimeShader: RuntimeShader? = null
	private var effectSignature = ""
	private var shaderBroken = false
	private var lightX = 0.866f
	private var lightY = 0.5f

	init {
		setWillNotDraw(false)
		isClickable = false
		isFocusable = false
	}

	fun setLight(x: Float, y: Float) {
		if (x == lightX && y == lightY) return
		lightX = x
		lightY = y
		effectSignature = ""
		invalidate()
	}

	fun onBackdropUpdated() {
		invalidate()
	}

	override fun onDraw(canvas: Canvas) {
		val backdrop = engine.backdrop() ?: return
		val loc = IntArray(2)
		getLocationInWindow(loc)
		val scale = engine.captureScale
		val src = RectF(
			loc[0] * scale,
			loc[1] * scale,
			(loc[0] + width) * scale,
			(loc[1] + height) * scale,
		)
		if (src.left >= backdrop.width || src.top >= backdrop.height || src.width() <= 0f || src.height() <= 0f) return
		src.left = src.left.coerceIn(0f, backdrop.width.toFloat())
		src.top = src.top.coerceIn(0f, backdrop.height.toFloat())
		src.right = src.right.coerceIn(0f, backdrop.width.toFloat())
		src.bottom = src.bottom.coerceIn(0f, backdrop.height.toFloat())
		val dst = RectF(0f, 0f, width.toFloat(), height.toFloat())

		val effect = ensureEffect()
		if (effect != null) {
			effectPaint.setRenderEffect(effect)
			canvas.saveLayer(0f, 0f, width.toFloat(), height.toFloat(), effectPaint)
			canvas.drawBitmap(backdrop, src, dst, bitmapPaint)
			canvas.restore()
			return
		}

		val radius = radiusPx()
		canvas.save()
		canvas.clipRect(dst)
		canvas.drawBitmap(backdrop, src, dst, bitmapPaint)
		val tint = params.tintColor
		val alpha = (params.dim.coerceIn(0f, 1f) * 255).toInt()
		fillPaint.color = (tint and 0x00FFFFFF) or (alpha shl 24)
		if (radius > 0f) {
			canvas.drawRoundRect(dst, radius, radius, fillPaint)
		} else {
			canvas.drawRect(dst, fillPaint)
		}
		val rimAlpha = (params.rim.coerceIn(0f, 2f) * 120).toInt().coerceIn(0, 255)
		rimPaint.style = Paint.Style.STROKE
		rimPaint.strokeWidth = 2f * resources.displayMetrics.density
		rimPaint.color = (0x00FFFFFF) or (rimAlpha shl 24)
		if (radius > 0f) {
			canvas.drawRoundRect(dst, radius, radius, rimPaint)
		} else {
			canvas.drawRect(dst, rimPaint)
		}
		canvas.restore()
	}

	private fun radiusPx(): Float = params.radiusPx.coerceAtMost(minOf(width, height) / 2f)

	private fun ensureEffect(): RenderEffect? {
		if (Build.VERSION.SDK_INT < 33 || shaderBroken) return null
		if (width == 0 || height == 0) return null
		val signature = "${params.signature()}|$width|$height|$lightX|$lightY"
		if (signature == effectSignature && runtimeShader != null) {
			return try {
				RenderEffect.createRuntimeShaderEffect(requireNotNull(runtimeShader), "content")
			} catch (_: Throwable) {
				shaderBroken = true
				null
			}
		}
		return try {
			val shader = RuntimeShader(GlassShader.SOURCE)
			shader.setFloat2Uniform("viewSize", width.toFloat(), height.toFloat())
			shader.setFloat2Uniform("halfBox", width / 2f + params.extendX, height / 2f + params.extendY)
			shader.setFloatUniform("radius", radiusPx())
			shader.setFloatUniform("bevel", params.bevelPx)
			shader.setFloatUniform("refractPx", params.refractPx)
			shader.setFloatUniform("falloff", params.falloff)
			shader.setFloatUniform("dispersion", params.dispersion)
			shader.setFloat2Uniform("lightDir", lightX, lightY)
			shader.setFloatUniform("specStrength", params.rim)
			shader.setFloatUniform("rimBand", 6f * resources.displayMetrics.density)
			val tintA = params.tintColorAlpha
			shader.setFloat4Uniform(
				"tintColor",
				((params.tintColor shr 16 and 0xFF) / 255f),
				((params.tintColor shr 8 and 0xFF) / 255f),
				((params.tintColor and 0xFF) / 255f),
				tintA,
			)
			shader.setFloatUniform("adaptiveTint", if (params.adaptive) 1f else 0f)
			shader.setFloatUniform("dimAmount", params.dim)
			shader.setFloatUniform("satFactor", params.sat)
			runtimeShader = shader
			effectSignature = signature
			RenderEffect.createRuntimeShaderEffect(shader, "content")
		} catch (_: Throwable) {
			shaderBroken = true
			null
		}
	}

	companion object {
		fun blurBitmap(source: Bitmap, radiusPx: Float): Bitmap {
			if (Build.VERSION.SDK_INT < 31 || radiusPx <= 0.5f) return source
			val out = Bitmap.createBitmap(source.width, source.height, Bitmap.Config.ARGB_8888)
			val canvas = Canvas(out)
			val paint = Paint()
			paint.setRenderEffect(
				RenderEffect.createBlurEffect(radiusPx, radiusPx, Shader.TileMode.CLAMP),
			)
			canvas.saveLayer(0f, 0f, out.width.toFloat(), out.height.toFloat(), paint)
			canvas.drawBitmap(source, 0f, 0f, null)
			canvas.restore()
			return out
		}
	}
}
