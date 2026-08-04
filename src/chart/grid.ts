import type { Complex } from "../math/smith";
import { zToGamma } from "../math/smith";

/** Resistance values for constant-r circles, by zoom density level 0..3 */
const R_LEVELS: number[][] = [
	[0, 0.2, 0.5, 1, 2, 5],
	[0, 0.1, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 5, 10],
	[
		0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.5, 2, 2.5, 3,
		4, 5, 7, 10, 20,
	],
	[
		0, 0.02, 0.05, 0.07, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8,
		0.9, 1, 1.1, 1.2, 1.5, 1.7, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 15, 20, 50,
	],
];

/** Reactance magnitudes for constant-x arcs */
const X_LEVELS: number[][] = [
	[0.2, 0.5, 1, 2, 5],
	[0.1, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 5, 10],
	[
		0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4,
		5, 7, 10, 20,
	],
	[
		0.02, 0.05, 0.07, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9,
		1, 1.1, 1.2, 1.5, 1.7, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 15, 20, 50,
	],
];

export function zoomToLevel(scale: number): number {
	if (scale >= 8) return 3;
	if (scale >= 4) return 2;
	if (scale >= 2) return 1;
	return 0;
}

export function getRValues(level: number): number[] {
	return R_LEVELS[Math.min(level, R_LEVELS.length - 1)];
}

export function getXValues(level: number): number[] {
	return X_LEVELS[Math.min(level, X_LEVELS.length - 1)];
}

/** Constant-r circle center and radius in Γ-plane */
export function rCircle(r: number): { cx: number; cy: number; radius: number } {
	if (r === Infinity) {
		return { cx: 1, cy: 0, radius: 0 };
	}
	const radius = 1 / (1 + r);
	const cx = r / (1 + r);
	return { cx, cy: 0, radius };
}

/** Constant-x arc circle center and radius in Γ-plane (math coords, Im up) */
export function xCircle(x: number): { cx: number; cy: number; radius: number } {
	const radius = 1 / Math.abs(x);
	return { cx: 1, cy: 1 / x, radius };
}

/**
 * True circular SVG arc for constant-x (r: ∞ → 0), clipped to the chart.
 * Uses path `A` so the stroke is smooth at any zoom.
 */
export function xArcPath(x: number): string {
	if (!Number.isFinite(x) || Math.abs(x) < 1e-12) return "";

	const R = 1 / Math.abs(x);
	// Math center (re, im); SVG uses y = -im
	const cxSvg = 1;
	const cySvg = -1 / x;

	const start = { re: 1, im: 0 };
	const end = zToGamma({ re: 0, im: x });

	const x1 = start.re;
	const y1 = -start.im;
	const x2 = end.re;
	const y2 = -end.im;

	const a0 = Math.atan2(y1 - cySvg, x1 - cxSvg);
	const a1 = Math.atan2(y2 - cySvg, x2 - cxSvg);

	// Candidate sweeps in SVG angle space (atan2, CCW in SVG coords)
	let dCcw = a1 - a0;
	while (dCcw <= 0) dCcw += 2 * Math.PI;
	while (dCcw > 2 * Math.PI) dCcw -= 2 * Math.PI;
	const dCw = 2 * Math.PI - dCcw;

	const midCcw = a0 + dCcw / 2;
	const midCw = a0 - dCw / 2;
	const insideCcw = arcMidInside(cxSvg, cySvg, R, midCcw);
	const useCcw = insideCcw;

	const delta = useCcw ? dCcw : dCw;
	const largeArc = delta > Math.PI ? 1 : 0;
	// SVG sweep-flag: 1 = angles increase (CCW in the SVG coordinate system)
	const sweep = useCcw ? 1 : 0;

	return `M ${x1} ${y1} A ${R} ${R} 0 ${largeArc} ${sweep} ${x2} ${y2}`;
}

function arcMidInside(
	cx: number,
	cy: number,
	R: number,
	ang: number
): boolean {
	const sx = cx + R * Math.cos(ang);
	const sy = cy + R * Math.sin(ang);
	// Convert SVG → Γ: (sx, -sy)
	return Math.hypot(sx, -sy) <= 1.002;
}

export function renderGrid(
	svgNS: string,
	parent: SVGGElement,
	level: number
): void {
	while (parent.firstChild) parent.removeChild(parent.firstChild);

	const frag = document.createDocumentFragment();
	const rVals = getRValues(level);
	const xVals = getXValues(level);

	const unit = document.createElementNS(svgNS, "circle");
	unit.setAttribute("cx", "0");
	unit.setAttribute("cy", "0");
	unit.setAttribute("r", "1");
	unit.setAttribute("class", "smith-unit-circle");
	frag.appendChild(unit);

	const realAxis = document.createElementNS(svgNS, "line");
	realAxis.setAttribute("x1", "-1");
	realAxis.setAttribute("y1", "0");
	realAxis.setAttribute("x2", "1");
	realAxis.setAttribute("y2", "0");
	realAxis.setAttribute("class", "smith-axis");
	frag.appendChild(realAxis);

	const imagAxis = document.createElementNS(svgNS, "line");
	imagAxis.setAttribute("x1", "0");
	imagAxis.setAttribute("y1", "-1");
	imagAxis.setAttribute("x2", "0");
	imagAxis.setAttribute("y2", "1");
	imagAxis.setAttribute("class", "smith-axis");
	frag.appendChild(imagAxis);

	const labelRs = new Set(
		level >= 2
			? [0, 0.2, 0.5, 1, 2, 5]
			: level >= 1
				? [0, 0.2, 0.5, 1, 2, 5]
				: [0, 0.5, 1, 2]
	);
	const labelXs = new Set(
		level >= 1 ? [0.5, 1, 2] : [0.5, 1, 2]
	);

	for (const r of rVals) {
		const { cx, radius } = rCircle(r);
		const c = document.createElementNS(svgNS, "circle");
		c.setAttribute("cx", String(cx));
		c.setAttribute("cy", "0");
		c.setAttribute("r", String(radius));
		c.setAttribute(
			"class",
			r === 0 || r === 1 ? "smith-grid-major" : "smith-grid"
		);
		frag.appendChild(c);

		if (labelRs.has(r)) {
			const label = document.createElementNS(svgNS, "text");
			label.setAttribute("x", String(cx - radius));
			label.setAttribute("y", "0.04");
			label.setAttribute("class", "smith-label");
			label.setAttribute("text-anchor", "middle");
			label.textContent = String(r);
			frag.appendChild(label);
		}
	}

	for (const x of xVals) {
		for (const sign of [1, -1]) {
			const xv = sign * x;
			const d = xArcPath(xv);
			if (!d) continue;
			const path = document.createElementNS(svgNS, "path");
			path.setAttribute("d", d);
			path.setAttribute(
				"class",
				x === 1 || x === 0.5 ? "smith-grid-major" : "smith-grid"
			);
			frag.appendChild(path);

			if (labelXs.has(x)) {
				const midZ: Complex = { re: 0.5, im: xv };
				const g = zToGamma(midZ);
				const label = document.createElementNS(svgNS, "text");
				label.setAttribute("x", String(g.re));
				label.setAttribute(
					"y",
					String(-g.im + (sign > 0 ? -0.03 : 0.06))
				);
				label.setAttribute("class", "smith-label");
				label.setAttribute("text-anchor", "middle");
				label.textContent = sign > 0 ? `+j${x}` : `−j${x}`;
				frag.appendChild(label);
			}
		}
	}

	parent.appendChild(frag);
}
