import {
    EventSource,
    Graph,
    InternalMouseEvent,
    PanningHandler,
    RubberBandHandler,
    SelectionCellsHandler,
} from '@maxgraph/core';

export class BackgroundOnlyPanningHandler extends PanningHandler {
    constructor(graph: Graph) {
        super(graph);
        this.useLeftButtonForPanning = true;
        this.usePopupTrigger         = false;
        this.ignoreCell              = false;
        // consumePanningTrigger est une méthode dans cette version de MaxGraph — pas d'affectation booléenne
    }

    isPanningTrigger(me: InternalMouseEvent): boolean {
        if (me.getEvent().button !== 0) return false;

        if (me.getCell() == null) {
            return true;
        }

        return false;
    }

    mouseDown(sender: EventSource, me: InternalMouseEvent): void {
        if (this.isPanningTrigger(me)) {
            super.mouseDown(sender, me);
            me.consume();
        }
    }

    mouseMove(sender: EventSource, me: InternalMouseEvent): void {
        if (this.active) {
            super.mouseMove(sender, me);
            me.consume();
        }
    }

    mouseUp(sender: EventSource, me: InternalMouseEvent): void {
        if (this.active) {
            super.mouseUp(sender, me);
            me.consume();
            this.reset();
        }
    }

    reset(): void {
        this.graph.getPlugin<SelectionCellsHandler>('SelectionCellsHandler')?.reset();
        this.graph.getPlugin<RubberBandHandler>('RubberBandHandler')?.reset();
    }
}
