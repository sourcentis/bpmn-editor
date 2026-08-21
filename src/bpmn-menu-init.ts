// src/bpmn-menu/initVertexMenu.ts
import { InternalEvent, type Cell, type EventObject, type Graph, UndoManager } from "@maxgraph/core";
import type { VertexMenuController, VertexActionId } from "./bpmn-menu";
import { makeDefaultHandlers } from "./bpmn-menu-handler";

export function initVertexMenuActions(
    graph: Graph,
    undoManager: UndoManager,
    menuEl: HTMLElement
): VertexMenuController {
// -------------------------------------------------------
// Helpers

    function getBaseStyleNames(cell: Cell): string[] {
        const s = (cell as any)?.style;
        const names = s?.baseStyleNames;
        return Array.isArray(names) ? names : [];
    }

    // Un clic sur un "state"/"gateway" touche quasi toujours son icône
    // interne (stateIcon), qui recouvre entièrement le sommet parent — voir
    // Graph.prototype.click dans maxgraph, qui pose `cell` sur le résultat
    // brut du hit-test (me.getCell()), sans jamais remonter vers un
    // ancêtre sélectionnable. Sans ce recentrage, currentCell (donc la
    // source/cible passée à addBPMNConnection par les actions "connect" /
    // "add-*") pointerait sur l'icône plutôt que sur le sommet BPMN réel :
    // l'icône n'a pas de BpmnMeta propre, et l'arête ainsi créée est alors
    // rejetée par bpmn-export.ts comme orpheline hors du modèle. Même
    // recentrage que celui déjà fait par le handler "color" (bpmn-menu-handler.ts).
    function resolveMenuCell(cell: Cell): Cell {
        const names = getBaseStyleNames(cell);
        if ((names.includes("stateIcon") || names.includes("bpmnBadge")) && cell.parent) {
            return cell.parent as Cell;
        }
        return cell;
    }

    function setActionVisible(action: string, visible: boolean) {
        const btn = menuEl.querySelector<HTMLElement>(`[data-action="${action}"]`);
        if (!btn) return;
        btn.classList.toggle("bpmn-editor-hidden", !visible);

        //éviter le focus/clavier sur un bouton masqué
        if (btn instanceof HTMLButtonElement) {
            btn.disabled = !visible;
            btn.tabIndex = visible ? 0 : -1;
        }
    }

    // Blanc interdit sur les arêtes (invisible sur fond blanc), noir interdit
    // sur les objets (illisible avec le texte noir des libellés) — voir
    // applyMenuVisibilityForCell.
    function setSwatchVisible(color: string, visible: boolean) {
        const swatch = menuEl.querySelector<HTMLElement>(`[data-color="${color}"]`);
        if (!swatch) return;
        swatch.classList.toggle("bpmn-editor-hidden", !visible);

        if (swatch instanceof HTMLButtonElement) {
            swatch.disabled = !visible;
            swatch.tabIndex = visible ? 0 : -1;
        }
    }

    // Nombre de boutons visibles par ligne (doit rester cohérent avec le
    // max-width de .bpmn-editor-vertex-menu, tuné pour une ligne de 4
    // boutons — voir le commentaire dans dom.ts).
    const BUTTONS_PER_ROW = 4;

    // Recalcule quels séparateurs (.bpmn-editor-menu-break) doivent être
    // visibles, en fonction des boutons réellement visibles pour la cellule
    // cliquée (certains sont masqués selon le type de vertex, voir
    // applyMenuVisibilityForCell ci-dessous). Un saut est affiché après
    // chaque 4e bouton visible (les boutons masqués ne comptent pas), quel
    // que soit le sous-ensemble de boutons visible pour la cellule cliquée.
    function recomputeMenuBreaks() {
        const buttons = Array.from(
            menuEl.querySelectorAll<HTMLElement>(".bpmn-editor-menu-btn")
        );

        let visibleCount = 0;

        for (const btn of buttons) {
            const next = btn.nextElementSibling as HTMLElement | null;
            const ownBreak = next?.classList.contains("bpmn-editor-menu-break") ? next : null;

            if (btn.classList.contains("bpmn-editor-hidden")) {
                ownBreak?.classList.add("bpmn-editor-hidden");
                continue;
            }

            visibleCount++;
            ownBreak?.classList.toggle("bpmn-editor-hidden", visibleCount % BUTTONS_PER_ROW !== 0);
        }
    }

    // -------------------------------------------------------
    // Show/Hide menu items based on cell style

    function applyMenuVisibilityForCell(cell: Cell) {

        // actions présentes dans TON menu
        const ALL_ACTIONS = [
            "add-state",
            "add-task",
            "add-gateway",
            "connect",
            "config",
            "color",
            "align",
            "add-annotations",
            "delete",
            "search",
            "rotate",
        ] as const;


        // défaut: tout visible (
        const actions = new Set<string>(ALL_ACTIONS as unknown as string[]);

        // "align" n'a de sens qu'en sélection multiple — voir
        // applyMenuVisibilityForMultiSelection, jamais pour une cellule seule.
        actions.delete("align");

        const baseStyles = getBaseStyleNames(cell);

        // 1) si c'est une edge: pas d'ajout de vertex
        if (cell.isEdge()) {
            actions.delete("add-state");
            actions.delete("add-task");
            actions.delete("add-gateway");
            actions.delete("connect");
            actions.delete("search");
            actions.delete("rotate");

            // not config for comments, data and database
            const sourceBaseStyles = cell.source ? getBaseStyleNames(cell.source): null;
            const targetBaseStyles = cell.target ? getBaseStyleNames(cell.target): null;
            if (sourceBaseStyles?.includes('annotation')||
                targetBaseStyles?.includes('annotation')||
                sourceBaseStyles?.includes('data')||
                targetBaseStyles?.includes('data')||
                sourceBaseStyles?.includes('database')||
                targetBaseStyles?.includes('database')
                )
                actions.delete("config");
        }

        // 2) si c'est une "state": pas de search
        else if (baseStyles.includes("state")||baseStyles.includes("stateIcon")) {
            actions.delete("search");
            actions.delete("rotate");
        }
        // 3) exemple: sur un "gateway" tu interdis la couleur
        else if (baseStyles.includes("gateway")) {
            actions.delete("search");
            actions.delete("rotate");
        }

        // 4) exemple: sur un "database" tu interdis add-gateway et add-state
        else if (baseStyles.includes("data") ||
            baseStyles.includes("database")) {
            actions.delete("add-gateway");
            actions.delete("add-state");
            actions.delete("rotate");
        }

        else if (baseStyles.includes("annotation")) {
            actions.delete("add-state");
            actions.delete("add-task");
            actions.delete("add-gateway");
            actions.delete("config");
            actions.delete("add-annotations");
            actions.delete("search");
            actions.delete("rotate");
        }

        else if (baseStyles.includes("lane")) {
            actions.delete("add-state");
            actions.delete("add-task");
            actions.delete("add-gateway");
            actions.delete("config");
        }
        else if (baseStyles.includes("process")) {
            actions.delete("rotate");
        }
        else if (baseStyles.includes("conversation")) {
            actions.delete("add-state");
            actions.delete("add-task");
            actions.delete("add-gateway");
            actions.delete("config");
            actions.delete("rotate");
        }
        else { /* unknown style — show all actions by default */ }

        // applique
        for (const action of ALL_ACTIONS) {
            setActionVisible(action, actions.has(action));
        }

        // blanc: pas sur les arêtes / noir: pas sur les objets
        setSwatchVisible("#ffffff", !cell.isEdge());
        setSwatchVisible("#000000", !cell.isVertex());

        recomputeMenuBreaks();
    }

    // Menu restreint affiché quand plusieurs cellules sont sélectionnées :
    // seuls "changer la couleur" et "supprimer" ont un sens à s'appliquer en
    // masse (voir handlers["color"]/["delete"] dans bpmn-menu-handler.ts, qui
    // itèrent sur ActionContext.cells). Tout le reste (ajout de vertex,
    // connect, config, search, rotate...) suppose une cellule unique.
    function applyMenuVisibilityForMultiSelection(cells: Cell[]) {
        const ALL_ACTIONS = [
            "add-state",
            "add-task",
            "add-gateway",
            "connect",
            "config",
            "color",
            "align",
            "add-annotations",
            "delete",
            "search",
            "rotate",
        ] as const;

        const actions = new Set<string>(["color", "delete"]);

        // "Aligner" ne fait quelque chose que s'il y a au moins deux sommets
        // (les arêtes sont ignorées par handlers["align"] — voir
        // bpmn-menu-handler.ts) : une sélection de deux arêtes, ou d'un seul
        // sommet + une arête, n'a rien à aligner.
        const vertexCount = cells.filter((c) => c.isVertex()).length;
        if (vertexCount > 1) actions.add("align");

        for (const action of ALL_ACTIONS) {
            setActionVisible(action, actions.has(action));
        }

        // Même règle que pour une cellule unique (voir applyMenuVisibilityForCell),
        // généralisée : blanc masqué seulement si TOUTE la sélection est faite
        // d'arêtes, noir masqué seulement si TOUTE la sélection est faite de
        // sommets — une sélection mixte garde les deux.
        const allEdges = cells.every((c) => c.isEdge());
        const allVertices = cells.every((c) => c.isVertex());
        setSwatchVisible("#ffffff", !allEdges);
        setSwatchVisible("#000000", !allVertices);

        recomputeMenuBreaks();
    }

    // Vrai entre la fin d'un geste "connect" (edge créée par
    // ConnectionHandler.connect(), voir bpmn-menu-handler.ts) et le clic
    // suivant traité par onGraphClick — les deux sont le même clic natif :
    // ConnectionHandler.mouseUp() fire InternalEvent.CONNECT de façon
    // synchrone AVANT de consommer l'événement et de rendre la main à
    // Graph.click(), qui fire tout de même InternalEvent.CLICK (juste marqué
    // consommé). Ce drapeau, et lui seul, permet de distinguer ce clic
    // "fin de connexion" d'un clic de sélection ordinaire : SelectionHandler
    // consomme LUI AUSSI systématiquement le mouseUp dès qu'une cellule a été
    // cliquée (cellWasClicked), donc `evt.isConsumed()` seul est vrai pour
    // quasi tous les clics et ne peut pas servir de test ici.
    let justConnected = false;
    const connectionHandler = ((graph as any).connectionHandler ?? graph.getPlugin("ConnectionHandler")) as any;
    const onConnectionMade = () => {
        justConnected = true;
    };
    connectionHandler?.addListener?.(InternalEvent.CONNECT, onConnectionMade);

    let currentCell: Cell | null = null;

    // Non-null (length > 1) uniquement pendant une sélection multiple : porte
    // l'ensemble des cellules ciblées par "color"/"delete" (voir onMenuClick).
    // null en sélection simple — `currentCell` seul fait foi dans ce cas.
    let currentCells: Cell[] | null = null;

    // 🔥 On accepte vertex OU edge
    const isMenuCell = (c: Cell | null | undefined) => !!c && (c.isVertex() || c.isEdge());

    // Cellules actuellement sélectionnées, résolues (icône/badge → parent) et
    // dédupliquées — deux entrées de sélection distinctes (ex: icône + son
    // parent, si jamais les deux finissaient sélectionnées) peuvent se
    // résoudre vers la même cellule réelle.
    const getSelectedMenuCells = (): Cell[] => {
        const raw = graph.getSelectionCells() as Cell[];
        const resolved = raw.filter(isMenuCell).map(resolveMenuCell);
        return Array.from(new Set(resolved));
    };

    // Distance (en pixels écran) au-delà de laquelle un mousedown->mouseup
    // sur une cellule est considéré comme un déplacement plutôt qu'un simple clic.
    const CLICK_MOVE_TOLERANCE = 4;

    // Position (écran) au moment du mousedown, pour détecter un déplacement
    // avant d'afficher le menu contextuel au relâchement du bouton.
    let mouseDownPoint: { x: number; y: number } | null = null;

    // true tant que le bouton de la souris est maintenu enfoncé sur le graph.
    // Sert à empêcher l'ouverture du menu pendant la pression/le déplacement:
    // SelectionHandler sélectionne la cellule (et déclenche donc l'écouteur de
    // sélection ci-dessous) dès le mousedown, avant même de savoir si le
    // geste sera un simple clic ou un drag.
    let pressed = false;

    const mouseListener = {
        mouseDown: (_sender: unknown, me: { getEvent: () => MouseEvent }) => {
            const evt = me.getEvent();
            mouseDownPoint = { x: evt.clientX, y: evt.clientY };
            pressed = true;
        },
        mouseMove: () => {},
        mouseUp: () => {
            pressed = false;
        },
    };
    // Inséré en tête de graph.mouseListeners (plutôt que via addMouseListener,
    // qui l'ajouterait en fin de liste) pour s'exécuter avant SelectionHandler,
    // déjà enregistré à la construction du graph: on doit lever `pressed`
    // avant que SelectionHandler ne sélectionne la cellule et ne déclenche
    // l'écouteur de sélection, dans le même passage synchrone du mousedown.
    graph.mouseListeners.unshift(mouseListener);

    const wasCellMoved = (e: MouseEvent | null) => {
        if (!e || !mouseDownPoint) return false;
        const dx = e.clientX - mouseDownPoint.x;
        const dy = e.clientY - mouseDownPoint.y;
        return Math.hypot(dx, dy) > CLICK_MOVE_TOLERANCE;
    };

    // Sert à "replacer" le menu quand la vue bouge
    let lastAnchor: { x: number; y: number } | null = null;

    const hide = () => {
        currentCell = null;
        currentCells = null;
        lastAnchor = null;
        setPaletteOpen(false);
        setAlignMenuOpen(false);
        menuEl.classList.add("bpmn-editor-hidden");
    };

    const ensureMenuInContainer = () => {
        if (menuEl.parentElement !== graph.container) graph.container.appendChild(menuEl);
    };

    // Convertit un MouseEvent en coords relatives au container du graph
    const getLocalPointFromMouse = (e: MouseEvent) => {
        const rect = graph.container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        return { x, y };
    };

    const placeMenuAt = (x: number, y: number) => {
        ensureMenuInContainer();

        // Récupérer le rect du container pour avoir sa position dans la viewport
        const rect = graph.container.getBoundingClientRect();

        // Tenir compte du scroll du container si il est scrollable
        const scrollLeft = graph.container.scrollLeft || 0;
        const scrollTop = graph.container.scrollTop || 0;

        // Convertir les coordonnées locales en coordonnées absolues du container
        // en ajoutant le scroll
        const absoluteX = x + scrollLeft;
        const absoluteY = y + scrollTop;

        // Offset pour ne pas être pile sous le curseur
        const OFFSET_X = 8;
        const OFFSET_Y = 8;

        // Clamp pour que le menu reste visible dans le container
        const maxX = rect.width + scrollLeft - menuEl.offsetWidth - 4;
        const maxY = rect.height + scrollTop - menuEl.offsetHeight - 4;

        const left = Math.max(scrollLeft, Math.min(Math.round(absoluteX + OFFSET_X), maxX));
        const top = Math.max(scrollTop, Math.min(Math.round(absoluteY + OFFSET_Y), maxY));

        menuEl.style.left = `${left}px`;
        menuEl.style.top = `${top}px`;
        menuEl.classList.remove("bpmn-editor-hidden");

        lastAnchor = { x: left, y: top };
    };
    // Fallback quand on n'a pas de MouseEvent (ex: reposition sur zoom/pan)
    const showForCellFallback = (cell: Cell) => {
        const state = graph.view.getState(cell);
        if (!state) return;

        applyMenuVisibilityForCell(cell);

        // No menu for icons
        if (cell?.style?.baseStyleNames?.includes("bpmnIcon")) return;

        // Si edge: on tente de viser le milieu
        if (cell.isEdge()) {
            const pts = (state as any).absolutePoints as Array<{ x: number; y: number }> | null | undefined;
            if (pts && pts.length >= 2) {
                const midIdx = Math.floor(pts.length / 2);
                const a = pts[midIdx - 1] ?? pts[0];
                const b = pts[midIdx] ?? pts[pts.length - 1];
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;

                // mx/my sont en coords "graph view", mais ton menu est dans container.
                // Comme tu utilises déjà state.x/state.y en pixels container pour les vertices,
                // on reste cohérent : state.absolutePoints est aussi en pixels (view coords) dans MaxGraph.
                placeMenuAt(mx, my);
                return;
            }
        }

        // Vertex: à droite comme avant
        if (cell.isVertex()) {
            const left = state.x + state.width + 8;
            const top = state.y;

            placeMenuAt(left, top);
            return;
        }

        // Si on arrive là: pas de placement fiable
        hide();
    };

    // Placement prioritaire: près du clic
    const showForCellAtMouse = (cell: Cell, e: MouseEvent) => {
        // No menu for icons
        if (cell?.style?.baseStyleNames?.includes("bpmnIcon")) return;
        applyMenuVisibilityForCell(cell);
        const p = getLocalPointFromMouse(e);
        placeMenuAt(p.x, p.y);
    };

    // Boîte englobante (coords container, comme state.x/y ailleurs dans ce
    // fichier) des cellules sélectionnées, pour ancrer le menu multi-sélection
    // quand on n'a pas de MouseEvent (ex: sélection en rectangle terminée sur
    // le fond, ou zoom/pan pendant qu'une sélection multiple est active).
    const getUnionScreenBounds = (cells: Cell[]) => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let found = false;
        for (const c of cells) {
            const state = graph.view.getState(c);
            if (!state) continue;
            found = true;
            minX = Math.min(minX, state.x);
            minY = Math.min(minY, state.y);
            maxX = Math.max(maxX, state.x + state.width);
            maxY = Math.max(maxY, state.y + state.height);
        }
        if (!found) return null;
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    };

    const showForMultiSelectionFallback = (cells: Cell[]) => {
        applyMenuVisibilityForMultiSelection(cells);
        const bounds = getUnionScreenBounds(cells);
        if (!bounds) return hide();
        placeMenuAt(bounds.x + bounds.width + 8, bounds.y);
    };

    const showForMultiSelectionAtMouse = (cells: Cell[], e: MouseEvent) => {
        applyMenuVisibilityForMultiSelection(cells);
        const p = getLocalPointFromMouse(e);
        placeMenuAt(p.x, p.y);
    };

    const updateFromSelection = () => {
        // ConnectionHandler.connect() sélectionne la nouvelle arête juste
        // après l'avoir créée (voir bpmn-menu-handler.ts / le commentaire de
        // `justConnected`), ce qui déclenche ce listener de sélection avant
        // même que le clic qui a terminé la connexion n'atteigne
        // onGraphClick. Sans ce garde-fou, choisir la destination d'une
        // flèche rouvrirait le menu contextuel sur cette arête tout juste
        // créée — non désiré : seul un clic explicite sur une cellule déjà
        // existante doit ouvrir le menu. On ne consomme pas `justConnected`
        // ici : c'est onGraphClick, plus tard dans le même clic, qui le fait.
        if (justConnected) return;

        const cells = getSelectedMenuCells();

        if (cells.length === 0) return hide();

        if (cells.length > 1) {
            currentCell = cells[0];
            currentCells = cells;

            // Même garde-fou qu'en sélection simple: on ne (re)positionne pas
            // tant que le bouton reste enfoncé (drag de sélection rectangle
            // en cours) — voir le commentaire équivalent ci-dessous.
            if (pressed) return;

            if (lastAnchor) {
                ensureMenuInContainer();
                applyMenuVisibilityForMultiSelection(cells);
                menuEl.style.left = `${lastAnchor.x}px`;
                menuEl.style.top = `${lastAnchor.y}px`;
                menuEl.classList.remove("bpmn-editor-hidden");
                return;
            }

            showForMultiSelectionFallback(cells);
            return;
        }

        currentCells = null;
        currentCell = cells[0];

        // Tant que le bouton est enfoncé, on ne (re)positionne pas le menu:
        // SelectionHandler sélectionne la cellule dès le mousedown, avant
        // de savoir si le geste est un clic ou un déplacement. L'ouverture
        // effective est décidée au relâchement par onGraphClick.
        if (pressed) return;

        // Si on a un ancrage (dernier clic), on garde l'emplacement
        if (lastAnchor) {
            ensureMenuInContainer();
            menuEl.style.left = `${lastAnchor.x}px`;
            menuEl.style.top = `${lastAnchor.y}px`;
            menuEl.classList.remove("bpmn-editor-hidden");
            return;
        }

        showForCellFallback(currentCell);
    };

    const handlers = makeDefaultHandlers();

    // 1) sélection
    const onSelectionChange = () => updateFromSelection();
    graph.getSelectionModel().addListener(InternalEvent.CHANGE, onSelectionChange);

    // 2) zoom/pan/redraw
    const onViewChanged = () => {
        if (!currentCell) return;

        // si on a un anchor (clic), on laisse tel quel (menu "collé" au clic),
        // sinon on recalcule via fallback
        if (!lastAnchor) showForCellFallback(currentCell);
    };
    graph.view.addListener(InternalEvent.SCALE, onViewChanged);
    graph.view.addListener(InternalEvent.TRANSLATE, onViewChanged);
    graph.view.addListener(InternalEvent.SCALE_AND_TRANSLATE, onViewChanged);
    graph.view.addListener(InternalEvent.DOWN, onViewChanged);
    graph.view.addListener(InternalEvent.UP, onViewChanged);

    // Palette de couleur
    const paletteEl = menuEl.querySelector<HTMLElement>('[data-role="color-palette"]');
    const colorBtn = menuEl.querySelector<HTMLElement>('[data-action="color"]');

    function setPaletteOpen(open: boolean) {
        if (!paletteEl || !colorBtn) return;
        paletteEl.classList.toggle("bpmn-editor-hidden", !open);
        colorBtn.setAttribute("aria-expanded", open ? "true" : "false");
        paletteEl.setAttribute("aria-hidden", open ? "false" : "true");
    }

    function togglePalette() {
        if (!paletteEl) return;
        const isOpen = !paletteEl.classList.contains("bpmn-editor-hidden");
        setAlignMenuOpen(false);
        setPaletteOpen(!isOpen);
    }

    // Sous-menu "aligner" (sélection multiple uniquement) — même mécanique
    // que la palette de couleur, mutuellement exclusif avec elle: ouvrir
    // l'un ferme l'autre.
    const alignMenuEl = menuEl.querySelector<HTMLElement>('[data-role="align-menu"]');
    const alignBtn = menuEl.querySelector<HTMLElement>('[data-action="align"]');

    function setAlignMenuOpen(open: boolean) {
        if (!alignMenuEl || !alignBtn) return;
        alignMenuEl.classList.toggle("bpmn-editor-hidden", !open);
        alignBtn.setAttribute("aria-expanded", open ? "true" : "false");
        alignMenuEl.setAttribute("aria-hidden", open ? "false" : "true");
    }

    function toggleAlignMenu() {
        if (!alignMenuEl) return;
        const isOpen = !alignMenuEl.classList.contains("bpmn-editor-hidden");
        setPaletteOpen(false);
        setAlignMenuOpen(!isOpen);
    }

    // 3) click menu
    const onMenuClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;

        e.preventDefault();
        e.stopPropagation();

        if (!currentCell || !isMenuCell(currentCell)) return;

        const swatch = target.closest<HTMLElement>("[data-color]");
        if (swatch) {
            handlers["color"]?.({
                graph,
                undoManager,
                cell: currentCell,
                cells: currentCells ?? undefined,
                parent: graph.getDefaultParent(),
                menuEl: target,
                event: e,
            });

            hide();
            return;
        }

        const alignBtnClicked = target.closest<HTMLElement>("[data-align]");
        if (alignBtnClicked) {
            handlers["align"]?.({
                graph,
                undoManager,
                cell: currentCell,
                cells: currentCells ?? undefined,
                parent: graph.getDefaultParent(),
                menuEl: target,
                event: e,
            });

            hide();
            return;
        }

        const action = target.closest<HTMLElement>("[data-action]")?.dataset.action as
            | VertexActionId
            | undefined;
        if (!action) return;

        if (action === "color") {
            togglePalette();
            return;
        }

        if (action === "align") {
            toggleAlignMenu();
            return;
        }

        setPaletteOpen(false);
        setAlignMenuOpen(false);

        handlers[action]?.({
            graph,
            undoManager,
            cell: currentCell,
            cells: currentCells ?? undefined,
            parent: graph.getDefaultParent(),
            menuEl,
            event: e,
        });

        // "connect"/"add-state"/"add-task"/"add-gateway"/"add-annotations"
        // masquent le menu elles-mêmes en manipulant directement
        // menuEl.classList (bpmn-menu-handler.ts), sans passer par hide() —
        // qui, seul, remet aussi currentCell/lastAnchor à null. Sans cette
        // resynchronisation, lastAnchor reste posé sur la cellule source :
        // quand ConnectionHandler.connect() sélectionne ensuite la nouvelle
        // arête, updateFromSelection() réutilise cet ancien lastAnchor et
        // rouvre le menu à la position de la source plutôt que de la
        // recalculer pour la nouvelle cible. "rotate" (qui ne masque jamais
        // le menu) ne déclenche pas cette branche : la condition ne porte que
        // sur ce que l'action a réellement fait, pas sur une liste d'actions.
        if (menuEl.classList.contains("bpmn-editor-hidden")) {
            hide();
        }
    };

    menuEl.addEventListener("click", onMenuClick);

    // 4) click dans le graph: 🔥 on affiche le menu aussi sur les edges + près du clic
    const onGraphClick = (_sender: unknown, evt: EventObject) => {
        const rawCell = evt.getProperty("cell") as Cell | null;
        const me = evt.getProperty("event") as MouseEvent | null; // MouseEvent natif

        // Si la souris a bougé entre le mousedown et le relâchement, il
        // s'agit d'un déplacement de l'objet et non d'un clic: on n'ouvre
        // pas le menu contextuel (la sélection, elle, reste gérée par maxgraph).
        const moved = wasCellMoved(me);
        mouseDownPoint = null;

        // Ce clic vient de terminer un geste "connect" (voir le commentaire de
        // `justConnected` ci-dessus) : ConnectionHandler.connect() a déjà
        // sélectionné la nouvelle arête, ce qui a déjà déclenché
        // updateFromSelection ci-dessus et positionné le menu en conséquence —
        // ne pas l'écraser ici en le rouvrant sur l'élément de destination.
        if (justConnected) {
            justConnected = false;
            return;
        }

        // Un déplacement d'une cellule déjà sélectionnée (drag du groupe) ne
        // doit ni ouvrir ni repositionner le menu — seul un clic net le fait.
        // Un rubber-band de sélection (glissé depuis le fond, donc rawCell
        // null) n'est PAS concerné : c'est un geste de sélection légitime,
        // pas un drag de cellule, même s'il parcourt une grande distance.
        if (rawCell && moved) return;

        const selected = getSelectedMenuCells();

        // Sélection multiple: menu restreint (couleur + suppression), ciblant
        // toutes les cellules sélectionnées — voir applyMenuVisibilityForMultiSelection.
        if (selected.length > 1) {
            currentCells = selected;
            currentCell = selected[0];

            if (me) {
                showForMultiSelectionAtMouse(selected, me);
                return;
            }

            lastAnchor = null;
            showForMultiSelectionFallback(selected);
            return;
        }

        currentCells = null;

        if (!rawCell || !isMenuCell(rawCell)) {
            hide();
            return;
        }

        const cell = resolveMenuCell(rawCell);
        currentCell = cell;

        // Priorité au clic exact
        if (me) {
            showForCellAtMouse(cell, me);
            return;
        }

        // Fallback
        lastAnchor = null;
        showForCellFallback(cell);
    };
    graph.addListener(InternalEvent.CLICK, onGraphClick);

    // 5) stop gestures
    const stop = (ev: Event) => {
        ev.preventDefault();
        ev.stopPropagation();
    };
    menuEl.addEventListener("mousedown", stop, true);
    menuEl.addEventListener("pointerdown", stop, true);

    hide();

    const destroy = () => {
        graph.getSelectionModel().removeListener(onSelectionChange as any);
        graph.view.removeListener(onViewChanged as any);
        graph.removeListener(onGraphClick as any);
        graph.removeMouseListener(mouseListener);
        connectionHandler?.removeListener?.(onConnectionMade);

        menuEl.removeEventListener("click", onMenuClick);
        menuEl.removeEventListener("mousedown", stop, true);
        menuEl.removeEventListener("pointerdown", stop, true);
    };

    return {
        destroy,
        getCurrentCell: () => currentCell,
        showForCell: (cell: Cell) => {
            if (!isMenuCell(cell)) return;
            const resolved = resolveMenuCell(cell);
            currentCell = resolved;
            currentCells = null;
            lastAnchor = null;
            showForCellFallback(resolved);
        },
        hide,
    };
}
