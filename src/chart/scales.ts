const SVG_NS = "http://www.w3.org/2000/svg";

/** Outer radius for angle tick marks (just outside unit circle) */
const ANGLE_R0 = 1.02;
const ANGLE_R1_MINOR = 1.045;
const ANGLE_R1_MAJOR = 1.07;
const ANGLE_LABEL_R = 1.12;

/** Wavelength scale further out */
const WL_R0 = 1.18;
const WL_R1_MINOR = 1.205;
const WL_R1_MAJOR = 1.23;
const WL_LABEL_R = 1.32;

function appendPath(parent: SVGGElement, d: string, cls: string): void {
	if (!d) return;
	const path = document.createElementNS(SVG_NS, "path");
	path.setAttribute("d", d);
	path.setAttribute("class", cls);
	parent.appendChild(path);
}

function tickSegment(
	degMath: number,
	r0: number,
	r1: number
): string {
	const rad = (degMath * Math.PI) / 180;
	const c = Math.cos(rad);
	const s = Math.sin(rad);
	return `M ${r0 * c} ${-r0 * s} L ${r1 * c} ${-r1 * s}`;
}

function tickLabel(
	parent: SVGGElement,
	degMath: number,
	r: number,
	text: string,
	cls: string
): void {
	const rad = (degMath * Math.PI) / 180;
	const label = document.createElementNS(SVG_NS, "text");
	label.setAttribute("x", String(r * Math.cos(rad)));
	label.setAttribute("y", String(-r * Math.sin(rad)));
	label.setAttribute("class", cls);
	label.setAttribute("text-anchor", "middle");
	label.setAttribute("dominant-baseline", "middle");
	label.textContent = text;
	parent.appendChild(label);
}

/**
 * Angle scale: degrees of arg(Γ).
 * Minor ticks batched into a single path to keep DOM light.
 */
export function renderAngleScale(
	parent: SVGGElement,
	level: number
): void {
	while (parent.firstChild) parent.removeChild(parent.firstChild);

	const minorStep = level >= 2 ? 2 : level >= 1 ? 5 : 5;
	const majorStep = 30;
	const labelStep = level >= 1 ? 15 : 30;

	let minorD = "";
	let majorD = "";

	for (let deg = -180; deg < 180; deg += minorStep) {
		const isMajor = deg % majorStep === 0;
		if (isMajor) {
			majorD += tickSegment(deg, ANGLE_R0, ANGLE_R1_MAJOR);
		} else {
			minorD += tickSegment(deg, ANGLE_R0, ANGLE_R1_MINOR);
		}
		if (deg % labelStep === 0) {
			tickLabel(
				parent,
				deg,
				ANGLE_LABEL_R,
				`${deg}°`,
				"smith-scale-label"
			);
		}
	}

	appendPath(parent, minorD, "smith-scale-minor");
	appendPath(parent, majorD, "smith-scale-major");
}

/**
 * Wavelength toward generator scale.
 * Full circle = 0.5 λ. λ=0 at Γ=+1 (deg=0), increases clockwise.
 */
export function renderWavelengthScale(
	parent: SVGGElement,
	level: number
): void {
	while (parent.firstChild) parent.removeChild(parent.firstChild);

	const minorStep = level >= 2 ? 0.005 : level >= 1 ? 0.01 : 0.01;
	const majorStep = 0.05;
	const labelStep = level >= 1 ? 0.025 : 0.05;

	let minorD = "";
	let majorD = "";
	const count = Math.round(0.5 / minorStep);

	for (let i = 0; i < count; i++) {
		const wl = i * minorStep;
		const mathDeg = -wl * 720;
		const isMajor =
			Math.abs(wl / majorStep - Math.round(wl / majorStep)) < 1e-9;
		if (isMajor) {
			majorD += tickSegment(mathDeg, WL_R0, WL_R1_MAJOR);
		} else {
			minorD += tickSegment(mathDeg, WL_R0, WL_R1_MINOR);
		}

		const nearLabel =
			Math.abs(wl / labelStep - Math.round(wl / labelStep)) < 1e-9;
		if (nearLabel) {
			const text = wl === 0 ? "0" : wl.toFixed(wl < 0.1 ? 3 : 2);
			tickLabel(parent, mathDeg, WL_LABEL_R, text, "smith-scale-label");
		}
	}

	appendPath(parent, minorD, "smith-scale-minor");
	appendPath(parent, majorD, "smith-scale-major");

	const title = document.createElementNS(SVG_NS, "text");
	title.setAttribute("x", "0");
	title.setAttribute("y", String(-(WL_LABEL_R + 0.08)));
	title.setAttribute("class", "smith-scale-title");
	title.setAttribute("text-anchor", "middle");
	title.textContent = "→ gen (λ)";
	parent.appendChild(title);
}

export function renderScales(
	angleGroup: SVGGElement,
	wlGroup: SVGGElement,
	level: number
): void {
	renderAngleScale(angleGroup, level);
	renderWavelengthScale(wlGroup, level);
}
