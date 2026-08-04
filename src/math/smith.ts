export type Complex = { re: number; im: number };

export type SmithPoint = {
	id: string;
	gamma: Complex;
	z: Complex;
	createdAt: number;
};

/** Normalized impedance z = r + jx → reflection coefficient Γ */
export function zToGamma(z: Complex): Complex {
	const denomRe = z.re + 1;
	const denomIm = z.im;
	const denomMag2 = denomRe * denomRe + denomIm * denomIm;
	if (denomMag2 < 1e-30) {
		return { re: 1, im: 0 };
	}
	const numRe = z.re - 1;
	const numIm = z.im;
	return {
		re: (numRe * denomRe + numIm * denomIm) / denomMag2,
		im: (numIm * denomRe - numRe * denomIm) / denomMag2,
	};
}

/** Reflection coefficient Γ → normalized impedance z */
export function gammaToZ(g: Complex): Complex {
	const denomRe = 1 - g.re;
	const denomIm = -g.im;
	const denomMag2 = denomRe * denomRe + denomIm * denomIm;
	if (denomMag2 < 1e-30) {
		return { re: Infinity, im: Infinity };
	}
	const numRe = 1 + g.re;
	const numIm = g.im;
	return {
		re: (numRe * denomRe + numIm * denomIm) / denomMag2,
		im: (numIm * denomRe - numRe * denomIm) / denomMag2,
	};
}

export function mag(c: Complex): number {
	return Math.hypot(c.re, c.im);
}

/** Angle of Γ in degrees, range (-180, 180] */
export function angleDeg(g: Complex): number {
	return (Math.atan2(g.im, g.re) * 180) / Math.PI;
}

/**
 * Wavelength toward generator (wtg) scale on Smith chart.
 * Full circle = 0.5 λ. Convention: λ = 0 at Γ = +1 (open/short right),
 * increasing clockwise (toward generator).
 */
export function wavelengthTowardGenerator(g: Complex): number {
	const deg = angleDeg(g);
	// At Γ=+1, deg=0 → λ=0. Clockwise = decreasing atan2 angle in math coords
	// (positive Im is upper half, counterclockwise from +Re).
	// Toward generator is clockwise → λ = (-deg / 360) * 0.5, wrapped to [0, 0.5)
	let wl = (-deg / 360) * 0.5;
	if (wl < 0) wl += 0.5;
	if (wl >= 0.5) wl -= 0.5;
	return wl;
}

export function clampToUnitDisk(g: Complex, maxR = 0.999): Complex {
	const m = mag(g);
	if (m <= maxR) return g;
	if (m < 1e-30) return { re: 0, im: 0 };
	return { re: (g.re / m) * maxR, im: (g.im / m) * maxR };
}

export function formatComplex(c: Complex, digits = 3): string {
	if (!Number.isFinite(c.re) || !Number.isFinite(c.im)) {
		return "∞";
	}
	const re = c.re.toFixed(digits);
	const im = Math.abs(c.im).toFixed(digits);
	const sign = c.im >= 0 ? "+" : "−";
	return `${re} ${sign} j${im}`;
}

export function formatGamma(g: Complex, digits = 3): string {
	return formatComplex(g, digits);
}

export function formatZ(z: Complex, digits = 3): string {
	if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) {
		return "∞";
	}
	return formatComplex(z, digits);
}

export function formatAngle(deg: number, digits = 1): string {
	return `${deg.toFixed(digits)}°`;
}

export function formatWavelength(wl: number, digits = 4): string {
	return `${wl.toFixed(digits)} λ`;
}

export function createPoint(gamma: Complex): SmithPoint {
	const g = clampToUnitDisk(gamma);
	return {
		id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
		gamma: g,
		z: gammaToZ(g),
		createdAt: Date.now(),
	};
}

/**
 * Polar coords in the Γ-plane: radius |Γ| ∈ [0, 1], angle in degrees.
 * Angle 0° = +Re (right), 90° = +Im (top), increases counterclockwise.
 */
export function polarToGamma(radius: number, angleDegInput: number): Complex {
	const r = Math.max(0, Math.min(1, radius));
	const rad = (angleDegInput * Math.PI) / 180;
	return {
		re: r * Math.cos(rad),
		im: r * Math.sin(rad),
	};
}

/** Angle in [0, 360) for UI display */
export function angleDeg360(g: Complex): number {
	let d = angleDeg(g);
	if (d < 0) d += 360;
	return d;
}
