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

const GRID_DEBOUNCE_MS = 140;

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
	private readonly viewExtent = 1.55;

	private width = 400;
	private height = 400;
	/** Cached layout; refreshed on resize / pointerdown / wheel start */
	private hostRect: DOMRect | null = null;

	private fadeEntries: FadeEntry[] = [];
	private pointEls = new Map<string, SVGCircleElement>();

	private gridTimer = 0;
	private pendingGridLevel = -1;
	private wheelRaf = 0;
	private wheelAcc = 0;
	private wheelX = 0;
	private wheelY = 0;
	private cursorRaf = 0;
	private pendingCursor: { x: number; y: number } | null = null;
	private lastVbW = 0;

	constructor(
		private host: HTMLElement,
		private callbacks: SmithChartCallbacks
	) {
		this.svg = document.createElementNS(SVG_NS, "svg");
		this.svg.setAttribute("class", "smith-svg");
		this.svg.setAttribute("xmlns", SVG_NS);

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
		this.clearGridTimer();
		if (this.wheelRaf) cancelAnimationFrame(this.wheelRaf);
		if (this.cursorRaf) cancelAnimationFrame(this.cursorRaf);
		this.svg.remove();
	}

	setSessionPoints(_points: SmithPoint[]): void {
		/* chart only shows fading points */
	}

	setFadePoints(entries: FadeEntry[]): void {
		this.fadeEntries = entries;
		this.syncPointElements();
	}

	resize(): void {
		this.hostRect = this.host.getBoundingClientRect();
		this.width = Math.max(this.hostRect.width, 100);
		this.height = Math.max(this.hostRect.height, 100);
		this.svg.setAttribute("width", String(this.width));
		this.svg.setAttribute("height", String(this.height));
		this.applyViewBox({ updateSizes: true, scheduleGrid: true });
	}

	resetView(): void {
		this.scale = 1;
		this.panX = 0;
		this.panY = 0;
		this.gridLevel = -1;
		this.applyViewBox({ updateSizes: true, scheduleGrid: false });
		this.redrawGrid(true);
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

		const rActive = this.pxToUser(POINT_PX_ACTIVE);
		const rFade = this.pxToUser(POINT_PX_FADE);
		const now = Date.now();

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
			c.setAttribute("r", String(isLatest ? rActive : rFade));
			c.setAttribute(
				"class",
				isLatest ? "smith-point-active" : "smith-point-fade"
			);
			const age = Math.max(0, now - (entry.expiresAt - FADE_MS));
			const anim = isLatest
				? "smith-point-fade-full"
				: "smith-point-fade-soft";
			c.style.animation = "none";
			c.style.animationDelay = "0s";
			// Restart CSS animation on SVG (no offsetWidth)
			requestAnimationFrame(() => {
				c!.style.animation = `${anim} ${FADE_MS}ms linear forwards`;
				c!.style.animationDelay = `-${age}ms`;
			});
		}
		this.cursorDot.setAttribute("r", String(this.pxToUser(CURSOR_PX)));
	}

	private pxToUser(px: number): number {
		const vbW = this.lastVbW || this.svg.viewBox.baseVal.width;
		if (!vbW || !this.width) return px * 0.01;
		return (px * vbW) / this.width;
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

	private applyViewBox(opts: {
		updateSizes?: boolean;
		scheduleGrid?: boolean;
	}): void {
		const aspect = this.width / this.height;
		let hw = this.viewExtent / this.scale;
		let hh = this.viewExtent / this.scale;
		if (aspect > 1) {
			hw *= aspect;
		} else {
			hh /= aspect;
		}
		const vbW = hw * 2;
		const vbH = hh * 2;
		const minX = this.panX - hw;
		const minY = this.panY - hh;
		this.lastVbW = vbW;
		this.svg.setAttribute("viewBox", `${minX} ${minY} ${vbW} ${vbH}`);

		if (opts.updateSizes) {
			this.updatePointSizes();
		}

		if (opts.scheduleGrid !== false) {
			const level = zoomToLevel(this.scale);
			if (level !== this.gridLevel) {
				this.scheduleGridRedraw(level);
			}
		}
	}

	private scheduleGridRedraw(level: number): void {
		this.pendingGridLevel = level;
		this.clearGridTimer();
		this.gridTimer = window.setTimeout(() => {
			this.gridTimer = 0;
			if (this.pendingGridLevel !== this.gridLevel) {
				this.redrawGrid(true);
			}
		}, GRID_DEBOUNCE_MS);
	}

	private clearGridTimer(): void {
		if (this.gridTimer) {
			window.clearTimeout(this.gridTimer);
			this.gridTimer = 0;
		}
	}

	private redrawGrid(force: boolean): void {
		const level = zoomToLevel(this.scale);
		if (!force && level === this.gridLevel) return;
		this.gridLevel = level;
		this.pendingGridLevel = level;
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

	private refreshHostRect(): void {
		this.hostRect = this.svg.getBoundingClientRect();
	}

	private clientToGamma(clientX: number, clientY: number): Complex {
		const rect = this.hostRect ?? this.svg.getBoundingClientRect();
		const aspect = this.width / this.height;
		let hw = this.viewExtent / this.scale;
		let hh = this.viewExtent / this.scale;
		if (aspect > 1) hw *= aspect;
		else hh /= aspect;
		const vbW = hw * 2;
		const vbH = hh * 2;
		const minX = this.panX - hw;
		const minY = this.panY - hh;
		const sx = (clientX - rect.left) / Math.max(rect.width, 1);
		const sy = (clientY - rect.top) / Math.max(rect.height, 1);
		return { re: minX + sx * vbW, im: -(minY + sy * vbH) };
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
		if (!this.hostRect) this.refreshHostRect();
		this.wheelX = e.clientX;
		this.wheelY = e.clientY;
		// Accumulate zoom factors within one frame
		const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
		this.wheelAcc = (this.wheelAcc || 1) * factor;
		if (!this.wheelRaf) {
			this.wheelRaf = requestAnimationFrame(() => {
				this.wheelRaf = 0;
				this.flushWheel();
			});
		}
	}

	private flushWheel(): void {
		const factor = this.wheelAcc || 1;
		this.wheelAcc = 0;
		const before = this.clientToGamma(this.wheelX, this.wheelY);
		const next = Math.min(
			this.maxScale,
			Math.max(this.minScale, this.scale * factor)
		);
		if (next === this.scale) return;
		this.scale = next;
		// Adjust pan so cursor stays put, then one viewBox update
		const aspect = this.width / this.height;
		let hw = this.viewExtent / this.scale;
		let hh = this.viewExtent / this.scale;
		if (aspect > 1) hw *= aspect;
		else hh /= aspect;
		const rect = this.hostRect ?? this.svg.getBoundingClientRect();
		const sx = (this.wheelX - rect.left) / Math.max(rect.width, 1);
		const sy = (this.wheelY - rect.top) / Math.max(rect.height, 1);
		// After scale, gamma under cursor without pan change:
		const afterRe = this.panX - hw + sx * hw * 2;
		const afterIm = -(this.panY - hh + sy * hh * 2);
		this.panX += before.re - afterRe;
		this.panY += -(before.im - afterIm);
		this.clampPan();
		this.applyViewBox({ updateSizes: true, scheduleGrid: true });
	}

	private clampPan(): void {
		const max = 1.2;
		this.panX = Math.max(-max, Math.min(max, this.panX));
		this.panY = Math.max(-max, Math.min(max, this.panY));
	}

	private onPointerDown(e: PointerEvent): void {
		if (e.button !== 0) return;
		this.refreshHostRect();
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
				// Pan: viewBox only — no point resize, no grid rebuild
				this.applyViewBox({ updateSizes: false, scheduleGrid: false });
			}
		}
		this.pendingCursor = { x: e.clientX, y: e.clientY };
		if (!this.cursorRaf) {
			this.cursorRaf = requestAnimationFrame(() => {
				this.cursorRaf = 0;
				if (!this.pendingCursor) return;
				const { x, y } = this.pendingCursor;
				this.pendingCursor = null;
				this.emitCursor(this.clientToGamma(x, y));
			});
		}
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
				this.callbacks.onPoint(createPoint(g));
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
