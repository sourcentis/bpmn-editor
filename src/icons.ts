// Bundled toolbar/menu icons — the same Bootstrap Icons (MIT licensed, see
// assets/icons/LICENSE-bootstrap-icons.txt) used by the editor's original
// Bootstrap-based chrome, base64-inlined (`?inline`) so the default UI needs
// no external icon font/CSS dependency.
import zoomIn from '../assets/icons/zoom-in.svg?inline';
import zoomOut from '../assets/icons/zoom-out.svg?inline';
import boxArrowInDown from '../assets/icons/box-arrow-in-down.svg?inline';
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

export const ICONS = {
    zoomIn,
    zoomOut,
    fit: arrowsFullscreen,
    undo: arrowCounterclockwise,
    redo: arrowClockwise,
    import: boxArrowInDown,
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
} as const;

export type IconName = keyof typeof ICONS;
