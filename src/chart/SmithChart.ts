import {
	type Complex,
	clampToUnitDisk,
	createPoint,
	gammaToZ,
	angleDeg,
	wavelengthTowardGenerator,
	formatGamma,
	formatZ,
	formatAngle,
	formatWavelength,
	type SmithPoint,
} from "../math/smith";
import { renderGrid, zoomToLevel } from "./grid";
import { renderScales } from "./scales";

const SVG_NS = "http://www.w3.org/2000/svg";

export type CursorInfo = {
	gamma: Complex;
	z: Complex;
	angle: number;
	wl: number;
} | null;

export type SmithChartCallbacks = {
	onCursor: (info: CursorInfo) => void;
	onPoint: (point: SmithPoint) => void;
};

export class SmithChart {
	readonly svg: SVGSVGElement;
	private world: SVGGElement;
	private gridG: SVGGElement;
	private angleG: SVGGElement;
	private wlG: SVGGElement;
	private pointsG: SVGGElement;
	private cursorDot: SVGCircleElement;

	private scale = 1;
	private panX = 0;
	private panY = 0;
	private gridLevel = -1;

	private dragging = false;
	private didDrag = false;
	private lastPtrX = 0;
	private lastPtrY = 0;

	private readonly minScale = 0.55;
	private readonly maxScale = 16;
	/** View half-extent at scale 1 (includes outer scales) */
	private readonly viewExtent = 1.55;

	private width = 400;
	private height = 400;

	private sessionPoints: SmithPoint[] = [];
	private fadePoints: SmithPoint[] = [];

	constructor(
		private host: HTMLElement,
		private callbacks: SmithChartCallbacks
	) {
		this.svg = document.createElementNS(SVG_NS, "svg");
		this.svg.setAttribute("class", "smith-svg");
		this.svg.setAttribute("xmlns", SVG_NS);

		const defs = document.createElementNS(SVG_NS, "defs");
		const clip = document.createElementNS(SVG_NS, "clipPath");
		clip.setAttribute("id", "smith-unit-clip");
		const clipCircle = document.createElementNS(SVG_NS, "circle");
		clipCircle.setAttribute("cx", "0");
		clipCircle.setAttribute("cy", "0");
		clipCircle.setAttribute("r", "1");
		clip.appendChild(clipCircle);
		defs.appendChild(clip);
		this.svg.appendChild(defs);

		this.world = document.createElementNS(SVG_NS, "g");
		this.world.setAttribute("class", "smith-world");

		this.angleG = document.createElementNS(SVG_NS, "g");
		this.angleG.setAttribute("class", "smith-angle-scale");
		this.wlG = document.createElementNS(SVG_NS, "g");
		this.wlG.setAttribute("class", "smith-wl-scale");
		this.gridG = document.createElementNS(SVG_NS, "g");
		this.gridG.setAttribute("class", "smith-grid-layer");
		this.pointsG = document.createElementNS(SVG_NS, "g");
		this.pointsG.setAttribute("class", "smith-points-layer");

		this.cursorDot = document.createElementNS(SVG_NS, "circle");
		this.cursorDot.setAttribute("r", "0.018");
		this.cursorDot.setAttribute("class", "smith-cursor-dot");
		this.cursorDot.style.display = "none";

		this.world.appendChild(this.wlG);
		this.world.appendChild(this.angleG);
		this.world.appendChild(this.gridG);
		this.world.appendChild(this.pointsG);
		this.world.appendChild(this.cursorDot);
		this.svg.appendChild(this.world);

		this.host.appendChild(this.svg);

		this.bindEvents();
		this.resize();
		this.redrawGrid(true);
	}

	destroy(): void {
		this.svg.remove();
	}

	setSessionPoints(points: SmithPoint[]): void {
		this.sessionPoints = points;
		this.redrawPoints();
	}

	setFadePoints(points: SmithPoint[]): void {
		this.fadePoints = points;
		this.redrawPoints();
	}

	resize(): void {
		const rect = this.host.getBoundingClientRect();
		this.width = Math.max(rect.width, 100);
		this.height = Math.max(rect.height, 100);
		this.svg.setAttribute("width", String(this.width));
		this.svg.setAttribute("height", String(this.height));
		this.applyViewBox();
	}

	resetView(): void {
		this.scale = 1;
		this.panX = 0;
		this.panY = 0;
		this.gridLevel = -1;
		this.applyViewBox();
	}

	private applyViewBox(): void {
		const aspect = this.width / this.height;
		let hw = this.viewExtent / this.scale;
		let hh = this.viewExtent / this.scale;
		if (aspect > 1) {
			hw *= aspect;
		} else {
			hh /= aspect;
		}
		const minX = this.panX - hw;
		const minY = this.panY - hh;
		this.svg.setAttribute(
			"viewBox",
			`${minX} ${minY} ${hw * 2} ${hh * 2}`
		);
		this.redrawGrid(false);
	}

	private redrawGrid(force: boolean): void {
		const level = zoomToLevel(this.scale);
		if (!force && level === this.gridLevel) return;
		this.gridLevel = level;
		renderGrid(SVG_NS, this.gridG, level);
		renderScales(this.angleG, this.wlG, level);
	}

	private redrawPoints(): void {
		while (this.pointsG.firstChild) {
			this.pointsG.removeChild(this.pointsG.firstChild);
		}

		const fadeIds = new Set(this.fadePoints.map((p) => p.id));
		const latestId =
			this.fadePoints.length > 0 ? this.fadePoints[0].id : null;

		for (const p of this.sessionPoints) {
			if (!fadeIds.has(p.id)) continue;
			const isLatest = p.id === latestId;
			const c = document.createElementNS(SVG_NS, "circle");
			c.setAttribute("cx", String(p.gamma.re));
			c.setAttribute("cy", String(-p.gamma.im));
			c.setAttribute("r", isLatest ? "0.022" : "0.016");
			c.setAttribute(
				"class",
				isLatest ? "smith-point-active" : "smith-point-fade"
			);
			this.pointsG.appendChild(c);
		}
	}

	private bindEvents(): void {
		this.svg.addEventListener("wheel", (e) => this.onWheel(e), {
			passive: false,
		});
		this.svg.addEventListener("pointerdown", (e) => this.onPointerDown(e));
		this.svg.addEventListener("pointermove", (e) => this.onPointerMove(e));
		this.svg.addEventListener("pointerup", (e) => this.onPointerUp(e));
		this.svg.addEventListener("pointerleave", () => this.onPointerLeave());
		this.svg.addEventListener("pointercancel", (e) => this.onPointerUp(e));
	}

	private clientToGamma(clientX: number, clientY: number): Complex {
		const rect = this.svg.getBoundingClientRect();
		const vb = this.svg.viewBox.baseVal;
		const sx = (clientX - rect.left) / rect.width;
		const sy = (clientY - rect.top) / rect.height;
		const svgX = vb.x + sx * vb.width;
		const svgY = vb.y + sy * vb.height;
		return { re: svgX, im: -svgY };
	}

	private emitCursor(g: Complex | null): void {
		if (!g) {
			this.cursorDot.style.display = "none";
			this.callbacks.onCursor(null);
			return;
		}
		const clamped = clampToUnitDisk(g);
		const inside = Math.hypot(g.re, g.im) <= 1.001;
		if (!inside) {
			this.cursorDot.style.display = "none";
			this.callbacks.onCursor(null);
			return;
		}
		this.cursorDot.style.display = "";
		this.cursorDot.setAttribute("cx", String(clamped.re));
		this.cursorDot.setAttribute("cy", String(-clamped.im));
		const z = gammaToZ(clamped);
		this.callbacks.onCursor({
			gamma: clamped,
			z,
			angle: angleDeg(clamped),
			wl: wavelengthTowardGenerator(clamped),
		});
	}

	private onWheel(e: WheelEvent): void {
		e.preventDefault();
		const before = this.clientToGamma(e.clientX, e.clientY);
		const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
		const next = Math.min(
			this.maxScale,
			Math.max(this.minScale, this.scale * factor)
		);
		if (next === this.scale) return;
		this.scale = next;
		this.applyViewBox();
		const after = this.clientToGamma(e.clientX, e.clientY);
		this.panX += before.re - after.re;
		this.panY += -(before.im - after.im);
		this.clampPan();
		this.applyViewBox();
	}

	private clampPan(): void {
		const max = 1.2;
		this.panX = Math.max(-max, Math.min(max, this.panX));
		this.panY = Math.max(-max, Math.min(max, this.panY));
	}

	private onPointerDown(e: PointerEvent): void {
		if (e.button !== 0) return;
		this.dragging = true;
		this.didDrag = false;
		this.lastPtrX = e.clientX;
		this.lastPtrY = e.clientY;
		this.svg.setPointerCapture(e.pointerId);
	}

	private onPointerMove(e: PointerEvent): void {
		if (this.dragging) {
			const dx = e.clientX - this.lastPtrX;
			const dy = e.clientY - this.lastPtrY;
			if (Math.hypot(dx, dy) > 3) this.didDrag = true;
			if (this.didDrag) {
				const aspect = this.width / this.height;
				let hw = this.viewExtent / this.scale;
				let hh = this.viewExtent / this.scale;
				if (aspect > 1) hw *= aspect;
				else hh /= aspect;
				this.panX -= (dx / this.width) * hw * 2;
				this.panY -= (dy / this.height) * hh * 2;
				this.clampPan();
				this.lastPtrX = e.clientX;
				this.lastPtrY = e.clientY;
				this.applyViewBox();
			}
		}
		const g = this.clientToGamma(e.clientX, e.clientY);
		this.emitCursor(g);
	}

	private onPointerUp(e: PointerEvent): void {
		if (!this.dragging) return;
		this.dragging = false;
		try {
			this.svg.releasePointerCapture(e.pointerId);
		} catch {
			/* ignore */
		}
		if (!this.didDrag) {
			const g = this.clientToGamma(e.clientX, e.clientY);
			if (Math.hypot(g.re, g.im) <= 1.001) {
				const point = createPoint(g);
				this.callbacks.onPoint(point);
			}
		}
		this.didDrag = false;
	}

	private onPointerLeave(): void {
		if (!this.dragging) {
			this.emitCursor(null);
		}
	}
}

export function formatCursorLine(info: NonNullable<CursorInfo>): string {
	return `Γ ${formatGamma(info.gamma)}  ·  z ${formatZ(info.z)}  ·  ${formatAngle(info.angle)}  ·  ${formatWavelength(info.wl)}`;
}
