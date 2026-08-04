import { App, ItemView, Modal, WorkspaceLeaf } from "obsidian";
import {
	SmithChart,
	formatCursorLine,
	type CursorInfo,
} from "../chart/SmithChart";
import { PointHistory, FADE_MS } from "../history/PointHistory";
import {
	createPoint,
	polarToGamma,
	type SmithPoint,
} from "../math/smith";

export const SMITH_VIEW_TYPE = "smith-chart-view";

export class SmithView extends ItemView {
	private chart: SmithChart | null = null;
	private history = new PointHistory();
	private hudEl: HTMLElement | null = null;
	private cursorEl: HTMLElement | null = null;
	private fadeListEl: HTMLElement | null = null;
	private chartHost: HTMLElement | null = null;
	private radiusInput: HTMLInputElement | null = null;
	private angleInput: HTMLInputElement | null = null;
	private polarHint: HTMLElement | null = null;
	private unsub: (() => void) | null = null;
	private fadeTimer: number | null = null;
	private resizeObs: ResizeObserver | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return SMITH_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Carta de Smith";
	}

	getIcon(): string {
		return "circle-dot";
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("smith-view");

		const toolbar = root.createDiv({ cls: "smith-toolbar" });

		const polar = toolbar.createDiv({ cls: "smith-polar-form" });
		polar.createEl("label", { text: "r", cls: "smith-polar-label" });
		this.radiusInput = polar.createEl("input", {
			cls: "smith-polar-input",
			attr: {
				type: "number",
				min: "0",
				max: "1",
				step: "0.01",
				placeholder: "0–1",
				value: "0.5",
			},
		});
		polar.createEl("label", { text: "∠°", cls: "smith-polar-label" });
		this.angleInput = polar.createEl("input", {
			cls: "smith-polar-input",
			attr: {
				type: "number",
				min: "0",
				max: "360",
				step: "0.1",
				placeholder: "0–360",
				value: "0",
			},
		});
		const addBtn = polar.createEl("button", {
			cls: "smith-btn",
			text: "Añadir",
		});
		addBtn.addEventListener("click", () => this.addFromPolar());
		this.radiusInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") this.addFromPolar();
		});
		this.angleInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") this.addFromPolar();
		});
		this.polarHint = polar.createSpan({ cls: "smith-polar-hint" });

		const histBtn = toolbar.createEl("button", {
			cls: "smith-btn",
			text: "Historial",
		});
		histBtn.addEventListener("click", () => this.openHistoryModal());

		const resetBtn = toolbar.createEl("button", {
			cls: "smith-btn",
			text: "Reset zoom",
		});
		resetBtn.addEventListener("click", () => {
			this.chart?.resetView();
		});

		this.hudEl = root.createDiv({ cls: "smith-hud" });
		this.cursorEl = this.hudEl.createDiv({ cls: "smith-cursor-readout" });
		this.cursorEl.setText("Mueve el cursor sobre la carta");
		this.fadeListEl = this.hudEl.createDiv({ cls: "smith-fade-list" });

		this.chartHost = root.createDiv({ cls: "smith-chart-host" });

		this.unsub = this.history.onChange(() => this.syncHudRows());
		this.recreateChart();
		this.syncHudRows();

		this.resizeObs = new ResizeObserver(() => {
			this.chart?.resize();
		});
		this.resizeObs.observe(this.chartHost);

		this.startFadeLoop();
	}

	async onClose(): Promise<void> {
		this.stopFadeLoop();
		this.resizeObs?.disconnect();
		this.resizeObs = null;
		this.unsub?.();
		this.unsub = null;
		this.chart?.destroy();
		this.chart = null;
	}

	private addFromPolar(): void {
		if (!this.radiusInput || !this.angleInput) return;
		const radius = parseFloat(this.radiusInput.value);
		const angle = parseFloat(this.angleInput.value);
		if (!Number.isFinite(radius) || !Number.isFinite(angle)) {
			this.setPolarHint("Valores numéricos inválidos");
			return;
		}
		if (radius < 0 || radius > 1) {
			this.setPolarHint("Radio debe estar entre 0 y 1");
			return;
		}
		const gamma = polarToGamma(radius, angle);
		this.onPoint(createPoint(gamma));
		this.setPolarHint("");
	}

	private setPolarHint(msg: string): void {
		if (this.polarHint) this.polarHint.setText(msg);
	}

	private recreateChart(): void {
		if (!this.chartHost) return;
		this.chart?.destroy();
		this.chartHost.empty();
		this.chart = new SmithChart(this.chartHost, {
			onCursor: (info) => this.onCursor(info),
			onPoint: (p) => this.onPoint(p),
		});
		this.chart.setFadePoints([...this.history.fading]);
		this.chart.resize();
	}

	private onCursor(info: CursorInfo): void {
		if (!this.cursorEl) return;
		if (!info) {
			this.cursorEl.setText("—");
			this.cursorEl.removeClass("is-active");
			return;
		}
		this.cursorEl.setText(formatCursorLine(info));
		this.cursorEl.addClass("is-active");
	}

	private onPoint(point: SmithPoint): void {
		this.history.add(point);
		this.chart?.setFadePoints([...this.history.fading]);
		this.syncHudRows();
	}

	/** Create/remove HUD rows when the set of fading points changes */
	private syncHudRows(): void {
		if (!this.fadeListEl) return;
		const keep = new Set(this.history.fading.map((e) => e.point.id));
		const existing = new Map<string, HTMLElement>();
		for (const child of Array.from(this.fadeListEl.children)) {
			const id = (child as HTMLElement).dataset.pointId;
			if (!id || !keep.has(id)) {
				child.remove();
			} else {
				existing.set(id, child as HTMLElement);
			}
		}

		for (const entry of this.history.fading) {
			let row = existing.get(entry.point.id);
			if (!row) {
				row = document.createElement("div");
				row.className = "smith-fade-row";
				row.dataset.pointId = entry.point.id;
				row.textContent = this.history.formatPoint(entry.point);
			}
			this.fadeListEl.appendChild(row);
		}
		this.updateHudOpacities();
	}

	private updateHudOpacities(): void {
		if (!this.fadeListEl) return;
		const now = Date.now();
		const byId = new Map(
			this.history.fading.map((e) => [e.point.id, e] as const)
		);
		for (const child of Array.from(this.fadeListEl.children)) {
			const row = child as HTMLElement;
			const entry = byId.get(row.dataset.pointId ?? "");
			if (!entry) continue;
			const remaining = Math.max(0, entry.expiresAt - now);
			const t = remaining / FADE_MS;
			const isLatest =
				this.history.fading.length > 0 &&
				entry.point.id === this.history.fading[0].point.id;
			const peak = isLatest ? 1 : 0.55;
			row.style.opacity = String(peak * t);
		}
	}

	private startFadeLoop(): void {
		this.stopFadeLoop();
		const tick = () => {
			const pruned = this.history.pruneExpired();
			if (pruned) {
				this.chart?.setFadePoints([...this.history.fading]);
				this.syncHudRows();
			} else {
				this.updateHudOpacities();
			}
			this.fadeTimer = window.requestAnimationFrame(tick);
		};
		this.fadeTimer = window.requestAnimationFrame(tick);
	}

	private stopFadeLoop(): void {
		if (this.fadeTimer !== null) {
			window.cancelAnimationFrame(this.fadeTimer);
			this.fadeTimer = null;
		}
	}

	private openHistoryModal(): void {
		new SessionHistoryModal(this.app, this.history, () => {
			this.chart?.setFadePoints([...this.history.fading]);
			this.syncHudRows();
		}).open();
	}
}

class SessionHistoryModal extends Modal {
	constructor(
		app: App,
		private history: PointHistory,
		private onClear: () => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("smith-history-modal");
		contentEl.createEl("h2", { text: "Historial de sesión" });

		const list = contentEl.createDiv({ cls: "smith-history-list" });
		if (this.history.session.length === 0) {
			list.createEl("p", { text: "No hay puntos en esta sesión." });
		} else {
			const ol = list.createEl("ol");
			const pts = [...this.history.session].reverse();
			for (const p of pts) {
				const li = ol.createEl("li");
				li.createSpan({ text: this.history.formatPoint(p) });
				const time = li.createSpan({ cls: "smith-history-time" });
				time.setText(`  ${new Date(p.createdAt).toLocaleTimeString()}`);
			}
		}

		const actions = contentEl.createDiv({ cls: "smith-history-actions" });
		const clearBtn = actions.createEl("button", {
			cls: "mod-warning",
			text: "Limpiar sesión",
		});
		clearBtn.addEventListener("click", () => {
			this.history.clearSession();
			this.onClear();
			this.close();
		});
		const closeBtn = actions.createEl("button", { text: "Cerrar" });
		closeBtn.addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
