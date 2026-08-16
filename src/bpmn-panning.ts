import {
    EventSource,
    Graph,
    InternalMouseEvent,
    PanningHandler,
    RubberBandHandler,
    SelectionCellsHandler,
} from '@maxgraph/core';

export class RightClickPanningHandler extends PanningHandler {
    private baseTranslateX = 0;
    private baseTranslateY = 0;

    constructor(graph: Graph) {
        super(graph);
        this.useLeftButtonForPanning = false;
        this.usePopupTrigger         = true;
        // ignoreCell reste à sa valeur par défaut (false) : mouseDown/mouseMove
        // ci-dessous n'y font jamais référence (isPanningTrigger est entièrement
        // réimplémenté), donc ignoreCell=true n'apporterait rien pour notre
        // propre logique — mais ce champ EST lu ailleurs, par le
        // forcePanningHandler hérité de PanningHandler (câblé dans son
        // constructeur sur InternalEvent.FIRE_MOUSE_EVENT, jamais surchargé
        // ici) via isForcePanningEvent() = `this.ignoreCell ||
        // isMultiTouchEvent(...)`. Le passer à true faisait donc démarrer un
        // panning "forcé" sur CHAQUE mousedown, bouton gauche compris — la vue
        // entière se translatait alors en plus du déplacement normal d'une
        // cellule par GraphHandler, empêchant tout déplacement individuel
        // (régression observée : tous les éléments semblaient se déplacer
        // ensemble).
    }

    isPanningTrigger(me: InternalMouseEvent): boolean {
        return me.getEvent().button === 2;
    }

    mouseDown(sender: EventSource, me: InternalMouseEvent): void {
        if (!me.isConsumed() && this.isPanningEnabled() && !this.active && this.isPanningTrigger(me)) {
            this.startX = me.getX();
            this.startY = me.getY();
            this.baseTranslateX = this.graph.getView().translate.x;
            this.baseTranslateY = this.graph.getView().translate.y;
            this.dx = 0;
            this.dy = 0;
            this.panningTrigger = true;
            me.consume();
        }
    }

    mouseMove(sender: EventSource, me: InternalMouseEvent): void {
        if (!this.active && !this.panningTrigger) return;

        this.dx = me.getX() - this.startX;
        this.dy = me.getY() - this.startY;

        if (!this.active) {
            this.active =
                Math.abs(this.dx) > this.graph.getSnapTolerance() ||
                Math.abs(this.dy) > this.graph.getSnapTolerance();
        }

        if (this.active) {
            // On pilote directement view.setTranslate() plutôt que de passer par
            // Graph.panGraph() (utilisé par PanningHandler.mouseMove) ou par le
            // panGraph() de PanningHandler lui-même (utilisé par son mouseUp) :
            // les deux ne s'appliquent que si `!useScrollbarsForPanning ||
            // !hasScrollbars(container)` — et hasScrollbars() ici vaut toujours
            // true car .bpmn-editor-canvas a `overflow: auto` (voir ui/dom.ts).
            // Passer `graph.useScrollbarsForPanning` à false pour lever ce garde
            // semblait la solution la plus simple, mais SelectionHandler appelle
            // `graph.scrollCellToVisible()` après CHAQUE déplacement de cellule
            // (scrollOnMove), qui repasse par le même hasScrollbars() ET regarde
            // CE MÊME drapeau global : le désactiver faisait alors translater
            // toute la vue à chaque drag de cellule, empêchant tout déplacement
            // individuel (régression observée). Piloter nous-mêmes
            // view.setTranslate() ici court-circuite entièrement ce mécanisme
            // sans toucher au drapeau global ni affecter scrollCellToVisible().
            const scale = this.graph.getView().scale;
            this.graph.getView().setTranslate(
                this.baseTranslateX + this.dx / scale,
                this.baseTranslateY + this.dy / scale,
            );
        }

        me.consume();
    }

    mouseUp(sender: EventSource, me: InternalMouseEvent): void {
        // Ce mouseUp reçoit TOUS les relâchements de bouton sur le graphe, pas
        // seulement ceux qui ont démarré un panning (tout MouseListener enregistré
        // via graph.addMouseListener reçoit chaque événement) — d'où le garde sur
        // `panningTrigger` : sans lui, reset() (ci-dessous) réinitialisait
        // SelectionCellsHandler/RubberBandHandler après CHAQUE relâchement de
        // clic gauche, y compris à la fin d'un déplacement de cellule normal, ce
        // qui faisait déplacer TOUTES les cellules ensemble au lieu d'une seule
        // (régression observée : plus aucun élément ne pouvait être déplacé
        // individuellement).
        if (!this.panningTrigger) return;

        if (this.active) {
            me.consume();
        }
        // Inconditionnel dès lors qu'on est bien dans un geste de panning
        // (panningTrigger true), y compris quand `active` est resté false (clic
        // droit sans déplacement suffisant pour dépasser la tolérance) : sinon
        // `panningTrigger` reste armé indéfiniment (voir reset()), et le
        // prochain mousemove — sur un simple survol, bouton relâché — serait
        // pris pour la suite d'un panning en cours par mouseMove() ci-dessus.
        this.reset();
    }

    reset(): void {
        // PanningHandler.reset() remet active/panningTrigger/dx/dy à leur état
        // initial — sans cet appel, `active` restait bloqué à `true` après le
        // tout premier panning aboutit (mouseUp) : plus aucun mousedown suivant
        // ne pouvait jamais redémarrer un panning (super.mouseDown() exige
        // `!this.active`), et pire, mouseMove() ci-dessus traitait alors TOUT
        // survol ultérieur (bouton relâché) comme un panning actif.
        super.reset();
        this.graph.getPlugin<SelectionCellsHandler>('SelectionCellsHandler')?.reset();
        this.graph.getPlugin<RubberBandHandler>('RubberBandHandler')?.reset();
    }
}
