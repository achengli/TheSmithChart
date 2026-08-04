import { Plugin, WorkspaceLeaf } from "obsidian";
import { SMITH_VIEW_TYPE, SmithView } from "./view/SmithView";

export default class SmithChartPlugin extends Plugin {
	async onload(): Promise<void> {
		this.registerView(SMITH_VIEW_TYPE, (leaf) => new SmithView(leaf));

		this.addCommand({
			id: "open-smith-chart",
			name: "Abrir carta de Smith",
			callback: () => this.activateView(),
		});

		this.addRibbonIcon("circle-dot", "Carta de Smith", () => {
			void this.activateView();
		});
	}

	async onunload(): Promise<void> {
		// Leaves are cleaned up by Obsidian
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const existing = workspace.getLeavesOfType(SMITH_VIEW_TYPE);
		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({
				type: SMITH_VIEW_TYPE,
				active: true,
			});
		}
		workspace.revealLeaf(leaf);
	}
}
