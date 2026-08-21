// Bundled toolbar/menu icons — the same Bootstrap Icons (MIT licensed, see
// assets/icons/LICENSE-bootstrap-icons.txt) used by the editor's original
// Bootstrap-based chrome, base64-inlined (`?inline`) so the default UI needs
// no external icon font/CSS dependency.
import zoomIn from '../assets/icons/zoom-in.svg?inline';
import zoomOut from '../assets/icons/zoom-out.svg?inline';
import boxArrowInDown from '../assets/icons/box-arrow-in-down.svg?inline';
import boxArrowUp from '../assets/icons/box-arrow-up.svg?inline';
import cardImage from '../assets/icons/card-image.svg?inline';
import floppyFill from '../assets/icons/floppy-fill.svg?inline';
import hexagon from '../assets/icons/hexagon.svg?inline';
import circle from '../assets/icons/circle.svg?inline';
import app from '../assets/icons/app.svg?inline';
import diamond from '../assets/icons/diamond.svg?inline';
import arrowRight from '../assets/icons/arrow-right.svg?inline';
import wrenchAdjustable from '../assets/icons/wrench-adjustable.svg?inline';
import paletteFill from '../assets/icons/palette-fill.svg?inline';
import arrowClockwise from '../assets/icons/arrow-clockwise.svg?inline';
import arrowCounterclockwise from '../assets/icons/arrow-counterclockwise.svg?inline';
import trashFill from '../assets/icons/trash-fill.svg?inline';
import search from '../assets/icons/search.svg?inline';
import arrowsFullscreen from '../assets/icons/arrows-fullscreen.svg?inline';
import alignLeft from '../assets/icons/align-left.svg?inline';
import alignCenter from '../assets/icons/align-center.svg?inline';
import alignRight from '../assets/icons/align-right.svg?inline';
import alignTop from '../assets/icons/align-top.svg?inline';
import alignMiddle from '../assets/icons/align-middle.svg?inline';
import alignBottom from '../assets/icons/align-bottom.svg?inline';

export const ICONS = {
    zoomIn,
    zoomOut,
    fit: arrowsFullscreen,
    undo: arrowCounterclockwise,
    redo: arrowClockwise,
    import: boxArrowInDown,
    exportBpmn: boxArrowUp,
    downloadSvg: cardImage,
    save: floppyFill,
    conversation: hexagon,
    addState: circle,
    addTask: app,
    addGateway: diamond,
    connect: arrowRight,
    config: wrenchAdjustable,
    color: paletteFill,
    rotate: arrowClockwise,
    delete: trashFill,
    search,
    // Main "align" menu button reuses the align-left glyph — like "color"
    // reusing the palette icon, it's just one representative of the submenu
    // it opens (see the align-* entries below), not meant to be exhaustive.
    align: alignLeft,
    alignLeft,
    alignCenter,
    alignRight,
    alignTop,
    alignMiddle,
    alignBottom,
} as const;

export type IconName = keyof typeof ICONS;
