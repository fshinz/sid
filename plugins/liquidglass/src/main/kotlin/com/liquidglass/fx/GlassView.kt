package com.liquidglass.fx

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.RenderNode
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
	val blurPx: Float,
	val rim: Float,
	val dim: Float,
	val sat: Float,
	val adaptive: Boolean,
	val tintColor: Int,
	val tintColorAlpha: Float,
) {
	fun signature(): String =
		"$radiusPx|$extendX|$extendY|$bevelPx|$refractPx|$falloff|$dispersion|$blurPx|$rim|$dim|$sat|$adaptive|$tintColor|$tintColorAlpha"
}

internal class GlassView(context: Context, private val engine: GlassEngine, var params: GlassParams) : View(context) {
	private val bitmapPaint = Paint(Paint.FILTER_BITMAP_FLAG)
	private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
	private val rimPaint = Paint(Paint.ANTI_ALIAS_FLAG)
	private var runtimeShader: RuntimeShader? = null
	private var lensNode: RenderNode? = null
	private var blurNode: RenderNode? = null
	private var effectSignature = ""
	private var blurSignature = ""
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
		val src = Rect(
			(loc[0] * scale).toInt().coerceIn(0, backdrop.width),
			(loc[1] * scale).toInt().coerceIn(0, backdrop.height),
			((loc[0] + width) * scale).toInt().coerceIn(0, backdrop.width),
			((loc[1] + height) * scale).toInt().coerceIn(0, backdrop.height),
		)
		if (src.width() <= 0 || src.height() <= 0) return
		val dst = RectF(0f, 0f, width.toFloat(), height.toFloat())

		if (canvas.isHardwareAccelerated) {
			val effect = ensureEffect()
			if (effect != null) {
				val node = obtainLensNode()
				node.setPosition(0, 0, width, height)
				node.setRenderEffect(effect)
				val recorder = node.beginRecording()
				recordBackdrop(recorder, backdrop, src, dst)
				node.endRecording()
				canvas.drawRenderNode(node)
				return
			}
			if (Build.VERSION.SDK_INT >= 31) {
				recordBackdrop(canvas, backdrop, src, dst)
				return
			}
		}
		drawFallback(canvas, backdrop, src, dst)
	}

	private fun drawFallback(canvas: Canvas, backdrop: Bitmap, src: Rect, dst: RectF) {
		val soft = softBlur(backdrop)
		val radius = radiusPx()
		canvas.save()
		canvas.clipRect(dst)
		canvas.drawBitmap(soft, src, dst, bitmapPaint)
		val alpha = (params.dim.coerceIn(0f, 1f) * 255).toInt()
		fillPaint.color = (params.tintColor and 0x00FFFFFF) or (alpha shl 24)
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

	private fun recordBackdrop(target: Canvas, backdrop: Bitmap, src: Rect, dst: RectF) {
		val blur = obtainBlurNode()
		val recorder = blur.beginRecording()
		recorder.drawBitmap(backdrop, src, dst, bitmapPaint)
		blur.endRecording()
		target.drawRenderNode(blur)
	}

	private fun radiusPx(): Float = params.radiusPx.coerceAtMost(minOf(width, height) / 2f)

	private fun obtainLensNode(): RenderNode {
		val current = lensNode
		if (current != null) return current
		val node = RenderNode("liquidglass-lens")
		lensNode = node
		return node
	}

	private fun obtainBlurNode(): RenderNode {
		val signature = "${params.blurPx}"
		val current = blurNode
		if (current != null && signature == blurSignature) return current
		val node = current ?: RenderNode("liquidglass-blur").also { blurNode = it }
		if (Build.VERSION.SDK_INT >= 31) {
			node.setRenderEffect(
				RenderEffect.createBlurEffect(
					params.blurPx.coerceAtLeast(0.5f),
					params.blurPx.coerceAtLeast(0.5f),
					Shader.TileMode.CLAMP,
				),
			)
		}
		blurSignature = signature
		return node
	}

	private fun ensureEffect(): RenderEffect? {
		if (Build.VERSION.SDK_INT < 33 || shaderBroken) return null
		if (width == 0 || height == 0) return null
		val signature = "${params.signature()}|$width|$height|$lightX|$lightY"
		if (signature != effectSignature || runtimeShader == null) {
			try {
				val shader = RuntimeShader(GlassShader.SOURCE)
				shader.setFloatUniform("viewSize", width.toFloat(), height.toFloat())
				shader.setFloatUniform("halfBox", width / 2f + params.extendX, height / 2f + params.extendY)
				shader.setFloatUniform("radius", radiusPx())
				shader.setFloatUniform("bevel", params.bevelPx)
				shader.setFloatUniform("refractPx", params.refractPx)
				shader.setFloatUniform("falloff", params.falloff)
				shader.setFloatUniform("dispersion", params.dispersion)
				shader.setFloatUniform("lightDir", lightX, lightY)
				shader.setFloatUniform("specStrength", params.rim)
				shader.setFloatUniform("rimBand", 6f * resources.displayMetrics.density)
				val tintA = params.tintColorAlpha
				shader.setFloatUniform(
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
			} catch (_: Throwable) {
				shaderBroken = true
				return null
			}
		}
		return try {
			RenderEffect.createRuntimeShaderEffect(requireNotNull(runtimeShader), "content")
		} catch (_: Throwable) {
			shaderBroken = true
			null
		}
	}

	companion object {
		fun softBlur(source: Bitmap): Bitmap {
			val sw = (source.width / 6).coerceAtLeast(2)
			val sh = (source.height / 6).coerceAtLeast(2)
			val small = Bitmap.createBitmap(sw, sh, Bitmap.Config.ARGB_8888)
			val smallCanvas = Canvas(small)
			val scalePaint = Paint(Paint.FILTER_BITMAP_FLAG)
			smallCanvas.scale(sw.toFloat() / source.width, sh.toFloat() / source.height)
			smallCanvas.drawBitmap(source, 0f, 0f, scalePaint)
			val out = Bitmap.createBitmap(source.width, source.height, Bitmap.Config.ARGB_8888)
			val outCanvas = Canvas(out)
			outCanvas.drawBitmap(small, null, Rect(0, 0, source.width, source.height), scalePaint)
			return out
		}
	}
}
