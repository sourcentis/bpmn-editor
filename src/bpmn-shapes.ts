import { Shape, CellState, AbstractCanvas2D, RectangleShape } from "@maxgraph/core";

// BPMN "Transaction" sub-process: a rounded rectangle with a double border
// (two concentric lines) instead of the single border every other task/
// activity shape uses. Each line is ~1px wide with ~1px of gap between them
// — see setTransactionVertex() in bpmn-helpers.ts, the only place this shape
// gets applied to a cell.
export class BpmnDoubleBorderRectangleShape extends RectangleShape {
    override paintVertexShape(c: AbstractCanvas2D, x: number, y: number, w: number, h: number): void {
        const inset = 2; // 1px stroke + 1px gap between the two borders

        if (this.isRounded) {
            const r = this.getArcSize(w, h);
            c.begin();
            c.roundrect(x, y, w, h, r, r);
            c.fillAndStroke();

            const ri = Math.max(0, r - inset);
            c.begin();
            c.roundrect(x + inset, y + inset, w - 2 * inset, h - 2 * inset, ri, ri);
            c.stroke();
        } else {
            c.begin();
            c.rect(x, y, w, h);
            c.fillAndStroke();

            c.begin();
            c.rect(x + inset, y + inset, w - 2 * inset, h - 2 * inset);
            c.stroke();
        }
    }
}

export class BpmnDataObjectShape extends Shape {
    override paintVertexShape(
        c: AbstractCanvas2D,
        x: number,
        y: number,
        w: number,
        h: number
    ) {
        const fold = Math.min(w, h) * 0.2;

        c.begin();
        c.moveTo(x, y);
        c.lineTo(x + w - fold, y);
        c.lineTo(x + w, y + fold);
        c.lineTo(x + w, y + h);
        c.lineTo(x, y + h);
        c.close();
        c.fillAndStroke();

        // coin replié
        c.begin();
        c.moveTo(x + w - fold, y);
        c.lineTo(x + w - fold, y + fold);
        c.lineTo(x + w, y + fold);
        c.stroke();
    }
}

