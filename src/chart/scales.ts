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

/**
 * Angle of Γ in math coords (CCW from +Re).
 * SVG y is flipped so we use -im when drawing.
 */
function tickLine(
	parent: SVGGElement,
	degMath: number,
	r0: number,
	r1: number,
	cls: string
): void {
	const rad = (degMath * Math.PI) / 180;
	const c = Math.cos(rad);
	const s = Math.sin(rad);
	const line = document.createElementNS(SVG_NS, "line");
	line.setAttribute("x1", String(r0 * c));
	line.setAttribute("y1", String(-r0 * s));
	line.setAttribute("x2", String(r1 * c));
	line.setAttribute("y2", String(-r1 * s));
	line.setAttribute("class", cls);
	parent.appendChild(line);
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
 * Math atan2: +90° at +Im (top of chart after y-flip display).
 * Major every 30°, minor every 5° (or denser when zoomed).
 */
export function renderAngleScale(
	parent: SVGGElement,
	level: number
): void {
	while (parent.firstChild) parent.removeChild(parent.firstChild);

	const minorStep = level >= 2 ? 1 : level >= 1 ? 2 : 5;
	const majorStep = 30;
	const labelStep = level >= 1 ? 15 : 30;

	for (let deg = -180; deg < 180; deg += minorStep) {
		const isMajor = deg % majorStep === 0;
		const r1 = isMajor ? ANGLE_R1_MAJOR : ANGLE_R1_MINOR;
		tickLine(
			parent,
			deg,
			ANGLE_R0,
			r1,
			isMajor ? "smith-scale-major" : "smith-scale-minor"
		);
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
}

/**
 * Wavelength toward generator scale.
 * Full circle = 0.5 λ. λ=0 at Γ=+1 (deg=0), increases clockwise.
 * Clockwise from +Re: math angle decreases.
 * Position: mathDeg = -wl / 0.5 * 360 = -wl * 720
 */
export function renderWavelengthScale(
	parent: SVGGElement,
	level: number
): void {
	while (parent.firstChild) parent.removeChild(parent.firstChild);

	const minorStep = level >= 2 ? 0.002 : level >= 1 ? 0.005 : 0.01;
	const majorStep = 0.05;
	const labelStep = level >= 1 ? 0.025 : 0.05;

	const count = Math.round(0.5 / minorStep);
	for (let i = 0; i < count; i++) {
		const wl = i * minorStep;
		const mathDeg = -wl * 720;
		const isMajor =
			Math.abs(wl / majorStep - Math.round(wl / majorStep)) < 1e-9;
		const r1 = isMajor ? WL_R1_MAJOR : WL_R1_MINOR;
		tickLine(
			parent,
			mathDeg,
			WL_R0,
			r1,
			isMajor ? "smith-scale-major" : "smith-scale-minor"
		);

		const nearLabel =
			Math.abs(wl / labelStep - Math.round(wl / labelStep)) < 1e-9;
		if (nearLabel) {
			const text =
				wl === 0 ? "0" : wl.toFixed(wl < 0.1 ? 3 : 2);
			tickLabel(parent, mathDeg, WL_LABEL_R, text, "smith-scale-label");
		}
	}

	// Ring labels
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
