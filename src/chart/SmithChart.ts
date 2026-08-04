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
import { FADE_MS, type FadeEntry } from "../history/PointHistory";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Point radius in screen pixels (does not grow with zoom) */
const POINT_PX_ACTIVE = 5.5;
const POINT_PX_FADE = 4.5;
const CURSOR_PX = 4.5;

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

	private fadeEntries: FadeEntry[] = [];
	private pointEls = new Map<string, SVGCircleElement>();
	private fadeRaf = 0;

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
		this.stopFadeLoop();
		this.svg.remove();
	}

	setSessionPoints(_points: SmithPoint[]): void {
		// Chart only shows points while they are fading
	}

	setFadePoints(entries: FadeEntry[]): void {
		this.fadeEntries = entries;
		this.syncPointElements();
		this.startFadeLoop();
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

	private syncPointElements(): void {
		const latestId =
			this.fadeEntries.length > 0 ? this.fadeEntries[0].point.id : null;
		const keep = new Set(this.fadeEntries.map((e) => e.point.id));

		for (const [id, el] of this.pointEls) {
			if (!keep.has(id)) {
				el.remove();
				this.pointEls.delete(id);
			}
		}

		for (const entry of this.fadeEntries) {
			const p = entry.point;
			let c = this.pointEls.get(p.id);
			const isLatest = p.id === latestId;
			if (!c) {
				c = document.createElementNS(SVG_NS, "circle");
				c.setAttribute("cx", String(p.gamma.re));
				c.setAttribute("cy", String(-p.gamma.im));
				this.pointsG.appendChild(c);
				this.pointEls.set(p.id, c);
			}
			c.setAttribute(
				"class",
				isLatest ? "smith-point-active" : "smith-point-fade"
			);
		}
		this.updatePointSizes();
		this.updatePointOpacities();
	}

	/** User-space radius that renders as `px` screen pixels at current zoom */
	private pxToUser(px: number): number {
		const vb = this.svg.viewBox.baseVal;
		if (!vb.width || !this.width) return px * 0.01;
		return (px * vb.width) / this.width;
	}

	private updatePointSizes(): void {
		const rActive = this.pxToUser(POINT_PX_ACTIVE);
		const rFade = this.pxToUser(POINT_PX_FADE);
		const latestId =
			this.fadeEntries.length > 0 ? this.fadeEntries[0].point.id : null;
		for (const entry of this.fadeEntries) {
			const el = this.pointEls.get(entry.point.id);
			if (!el) continue;
			el.setAttribute(
				"r",
				String(entry.point.id === latestId ? rActive : rFade)
			);
		}
		this.cursorDot.setAttribute("r", String(this.pxToUser(CURSOR_PX)));
	}

	private updatePointOpacities(): void {
		const now = Date.now();
		for (const entry of this.fadeEntries) {
			const el = this.pointEls.get(entry.point.id);
			if (!el) continue;
			const remaining = Math.max(0, entry.expiresAt - now);
			const t = remaining / FADE_MS;
			const isLatest =
				this.fadeEntries.length > 0 &&
				entry.point.id === this.fadeEntries[0].point.id;
			const peak = isLatest ? 1 : 0.55;
			el.setAttribute("opacity", String(peak * t));
		}
	}

	private startFadeLoop(): void {
		this.stopFadeLoop();
		if (this.fadeEntries.length === 0) return;
		const tick = () => {
			this.updatePointOpacities();
			if (this.fadeEntries.some((e) => e.expiresAt > Date.now())) {
				this.fadeRaf = requestAnimationFrame(tick);
			} else {
				this.fadeRaf = 0;
			}
		};
		this.fadeRaf = requestAnimationFrame(tick);
	}

	private stopFadeLoop(): void {
		if (this.fadeRaf) {
			cancelAnimationFrame(this.fadeRaf);
			this.fadeRaf = 0;
		}
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
		this.updatePointSizes();
	}

	private redrawGrid(force: boolean): void {
		const level = zoomToLevel(this.scale);
		if (!force && level === this.gridLevel) return;
		this.gridLevel = level;
		renderGrid(SVG_NS, this.gridG, level);
		renderScales(this.angleG, this.wlG, level);
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
