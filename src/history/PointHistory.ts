import type { SmithPoint } from "../math/smith";
import {
	formatAngle,
	formatGamma,
	formatWavelength,
	formatZ,
	wavelengthTowardGenerator,
	angleDeg,
} from "../math/smith";

export const FADE_MS = 6000;
export const MAX_VISIBLE_FADE = 12;

export type FadeEntry = {
	point: SmithPoint;
	expiresAt: number;
};

export class PointHistory {
	readonly session: SmithPoint[] = [];
	readonly fading: FadeEntry[] = [];
	private listeners = new Set<() => void>();

	onChange(cb: () => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	private emit(): void {
		for (const cb of this.listeners) cb();
	}

	add(point: SmithPoint): void {
		this.session.push(point);
		this.fading.unshift({
			point,
			expiresAt: Date.now() + FADE_MS,
		});
		while (this.fading.length > MAX_VISIBLE_FADE) {
			this.fading.pop();
		}
		this.emit();
	}

	/** Drop expired fade rows; returns true if anything changed */
	pruneExpired(): boolean {
		const now = Date.now();
		const before = this.fading.length;
		const next = this.fading.filter((e) => e.expiresAt > now);
		const changed = next.length !== before;
		if (changed) {
			this.fading.length = 0;
			this.fading.push(...next);
			this.emit();
		}
		return changed;
	}

	clearSession(): void {
		this.session.length = 0;
		this.fading.length = 0;
		this.emit();
	}

	formatPoint(p: SmithPoint): string {
		const ang = angleDeg(p.gamma);
		const wl = wavelengthTowardGenerator(p.gamma);
		return `Γ ${formatGamma(p.gamma)}  ·  z ${formatZ(p.z)}  ·  ${formatAngle(ang)}  ·  ${formatWavelength(wl)}`;
	}
}
