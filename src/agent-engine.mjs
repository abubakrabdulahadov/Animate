import {Editor} from './editor.mjs';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
function fields(value, allowed) {
  if (!object(value)) throw new TypeError('Expected an object.');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown field: ${key}`);
}
function number(value, label, integer = false) {
  if (!Number.isFinite(value) || integer && !Number.isSafeInteger(value)) throw new TypeError(`${label} must be a finite ${integer ? 'integer' : 'number'}.`);
  return value;
}

/** DOM-free access to the same editable document and commands as the app. */
export class AgentEngine {
  constructor({document, name} = {}) {
    this.editor = new Editor({demo: false});
    const title = name ?? document?._styk?.name ?? 'Agent animation';
    if (document) this.editor.load(document, title);
    else this.editor.name = title;
  }
  inspect() {
    const e = this.editor;
    return {name: e.name, revision: e.revision, frame: e.frameIndex, tick: e.tick,
      frames: e.report.keyframes.length, totalTicks: e.totalTicks, fps: e.report.fps,
      width: e.report.canvas_width, height: e.report.canvas_height,
      canUndo: e.canUndo, canRedo: e.canRedo,
      figures: e.report.figure_types.map(f => ({id: f.figure_type_id, name: f.name,
        joints: f.segments.map(s => ({id: s.segment_id, parent: s.parent_id}))})),
      objects: e.selectionFrame.objects.map(o => ({uid: o.unique_id, figureId: o.figure_type_id,
        x: o.root_x, y: o.root_y, scale: o.scale}))};
  }
  snapshot() { return this.editor.serialize(); }
  execute(command) {
    if (!object(command) || typeof command.op !== 'string') throw new TypeError('A command needs an op string.');
    const e = this.editor;
    const check = keys => fields(command, ['op', ...keys]);
    const select = () => {
      number(command.uid, 'uid', true);
      if (!e.selectionFrame.objects.some(o => o.unique_id === command.uid)) throw new Error(`Object ${command.uid} is absent at this frame.`);
      e.select(command.uid);
    };
    switch (command.op) {
      case 'inspect': check([]); break;
      case 'project':
        check(['width', 'height', 'fps']);
        e.updateProject({...(command.width === undefined ? {} : {canvas_width: command.width}),
          ...(command.height === undefined ? {} : {canvas_height: command.height}),
          ...(command.fps === undefined ? {} : {fps: command.fps})}); break;
      case 'addFigure':
        check(['figureId']);
        if (command.figureId !== undefined && !e.report.figure_types.some(f => f.figure_type_id === command.figureId)) throw new Error('Unknown figureId.');
        e.addFigure(command.figureId); break;
      case 'importFigure':
        check(['document']);
        if (!object(command.document)) throw new TypeError('Expected a native figure document.');
        e.importFigure(command.document); break;
      case 'draw':
        check(['uid', 'segments']);
        if (!Array.isArray(command.segments) || !command.segments.length) throw new TypeError('Expected a nonempty segments array.');
        for (const segment of command.segments) fields(segment, ['parentId', 'type', 'length', 'angle', 'thickness', 'start']);
        if (command.uid === undefined) e.select(null); else select();
        e.addSegments(command.segments); break;
      case 'selectFrame':
        check(['index']); number(command.index, 'index', true);
        if (command.index < 0 || command.index >= e.report.keyframes.length) throw new RangeError('Frame index is out of range.');
        e.selectFrame(command.index); break;
      case 'seek':
        check(['tick']); number(command.tick, 'tick', true);
        if (command.tick < 0 || command.tick >= e.totalTicks) throw new RangeError('Tick is out of range.');
        e.seek(command.tick); break;
      case 'duplicateFrame': check([]); e.duplicateFrame(); break;
      case 'deleteFrame': check([]); e.deleteFrame(); break;
      case 'duration': check(['ticks']); e.setFrameDuration(command.ticks); break;
      case 'move':
        check(['uid', 'dx', 'dy']); number(command.dx, 'dx'); number(command.dy, 'dy');
        select(); e.moveSelection(command.dx, command.dy); break;
      case 'rotate':
        check(['uid', 'radians']); number(command.radians, 'radians');
        select(); e.rotateFigure(command.radians); break;
      case 'scale':
        check(['uid', 'factor']); number(command.factor, 'factor');
        if (command.factor <= 0) throw new RangeError('factor must be positive.');
        select(); e.scaleSelection(command.factor); break;
      case 'style': {
        check(['uid', 'jointId', 'values']);
        fields(command.values, ['color_rgb', 'thickness', 'transparency']);
        if (command.values.thickness !== undefined) {
          number(command.values.thickness, 'thickness');
          if (command.values.thickness < 0) throw new RangeError('thickness must be nonnegative.');
        }
        select();
        const index = e.figure.segments.findIndex(s => s.segment_id === command.jointId);
        if (index < 0) throw new Error('Unknown jointId.');
        e.select(command.uid, index); e.updateSegment(command.values); break;
      }
      case 'pose': {
        check(['uid', 'jointId', 'x', 'y']); number(command.x, 'x'); number(command.y, 'y');
        select();
        const index = e.figure.segments.findIndex(s => s.segment_id === command.jointId);
        if (index < 0) throw new Error('Unknown jointId.');
        e.select(command.uid, index); e.poseJoint(command.x, command.y); break;
      }
      case 'deleteFigure': check(['uid']); select(); e.deleteFigure(); break;
      case 'camera':
        check(['values']); fields(command.values, ['x', 'y', 'scale', 'angle_rad']);
        e.setCameraValues(command.values); break;
      case 'background': check(['argb']); e.setBackgroundColor(command.argb); break;
      case 'undo': check([]); e.undo(); break;
      case 'redo': check([]); e.redo(); break;
      default: throw new Error(`Unknown operation: ${command.op}`);
    }
    return this.inspect();
  }
}
