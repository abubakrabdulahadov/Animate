/** Explicit JSON-callable editor surface. Resource owners and callback APIs stay in their owning runtime. */
const groups = {
  figures: `addFigure importFigure duplicateFigure copyFigure cutFigure pasteFigure deleteFigure deleteSelection
    moveSelection moveSelectionInFrames rotateSelection scaleSelection scaleSelected mirrorSelection moveSelectionLayer
    copySelection cutSelection pasteSelection duplicateSelection updateObject updateSelection mirrorFigure rotateFigure
    centerFigure resetPose joinTo unjoinFigure joinFigure replaceFigureDefinition joinedFigureIds combineJoinedFigure
    bringToFront sendToBack orderSelection alignSelection`,
  shapes: `addSegment addSegments deleteSegment deleteSingleSegment unsplitSegment splitSegment setOrigin
    mirrorSegment mirrorSegmentBranch moveBuilderSegment addSpriteSegment moveBuilderOrder setBuilderOrder
    setPolygonOpacity updateBuilderSegmentStyle updateSegmentBranchStyle changeBranchThickness setBranchCaps
    setBranchFill splitSegmentBranch splitBuilderSegments addPolygon updatePolygon removePolygon updateFigureStyle
    updateSegmentStyle updateSegment convertSegment duplicateSegment duplicateSegmentBranch canDisconnectSegment disconnectSegment`,
  rig: `rotateJoint poseJoint bendJoint editRigJoint enableSmartStretch addConnector addWeightedJoint setRigBehavior
    setAngleLock setSecondaryAngleReference bindStretchParts setConnectorPosition slideConnector getIKSettings setNodeIK
    poseIKTarget rotateIKTarget nudgeHandle alignHandle segmentValues setSegmentValues copySegmentValues pasteSegmentValues`,
  spatial: `getSpatialCamera setSpatialCamera getSpatialProportions setSpatialProportions resetSpatialProportions
    setPoseChoice getSpatialIKPole setSpatialIKPole setSpatialIKTarget setSpatialFeetPinned getSpatialPose setSpatialPose
    resetSpatialPose twistSpatialJoint poseSpatialJoint getSpatialMotion setSpatialMotion poseSpatialIKDepth`,
  selection: `select selectMany selectConnected selectPolygon toggleSegment selectBranch copyBranchSelection
    selectSameDefinition invertSelection selectMarquee`,
  frames: `selectFrame seek addFrame duplicateFrame cutFrames deleteFrames reverseFrames deleteFrame setFrameDuration
    setFramesDuration setFramesEasing duplicateFrames insertBlankFrame bakeFrames getFrameId getFrameById frameIndexForId
    captureFrameSource moveFrame insertDuplicateFrames copyFrames pasteFrames appendClipboardFrames insertClipboardFrames
    frameClipboardDocument restoreFrameClipboard previewInbetween insertInbetweenFrames insertInbetweenFramesAsync`,
  ranges: `addFigureInFrames pasteFiguresInFrames duplicateFiguresInFrames duplicateInFrames deleteFiguresInFrames
    updateFiguresInFrames orderFiguresInFrames joinFiguresInFrames detachFiguresInFrames mirrorFiguresInFrames
    scaleFiguresInFrames rotateFiguresInFrames alignFiguresInFrames centerFiguresInFrames resetPoseInFrames`,
  layers: `getLayers getLayer layerForUid getLayerFigureUids setActiveLayer createLayer renameLayer setLayerColor
    deleteLayer reorderLayers moveLayerTo assignFiguresToLayer setLayerVisible setLayerLocked getLayerFolders
    createLayerFolder renameLayerFolder moveLayersToFolder arrangeLayers deleteLayerFolder getLayerFocus setLayerFocus
    clearLayerFocus isLayerFocusLocked isFigureFocusLocked`,
  animation: `nativePropertyChannel segmentAnimationTarget resolveAnimationTarget animationChannel animationValue
    nearestAnimationKey nativePoseChannel adoptNativePoseTrack addAnimationKey addAnimationKeys setAnimationKey
    setAnimationKeysEasing revealAnimationKey scaleAnimationKeys moveAnimationKeys deleteAnimationKeys duplicateAnimationKeys
    setMotionPathFalloff motionPathFalloff motionPathReport`,
  sheet: `selectSheetLayer layerFrameKeys sheetSpan sheetEditTimes sheetSetDuration sheetAppendFrame
    sheetInsertKey sheetDuplicateFrameAfter sheetSetEasing sheetClearKeys sheetClearFrames sheetInsertFrames
    sheetRemoveFrames sheetCopyFrames sheetPasteFrames sheetMoveFrames sheetTransferFrames`,
  camera: `copyCamera pasteCamera setCameraValues resetCamera transformCamera centerCamera alignCameraToView
    applyCameraToFigures locateCamera getCameraMotions copyCameraMotion pasteCameraMotion addCameraMotion
    setCameraMotion deleteCameraMotion duplicateCameraMotion randomizeCameraMotion setLayerParallax bakeCameraMotion`,
  scene: `setFPS setCanvasSize updateProject setBackgroundColor importBackground setSceneColor setSceneBackground
    importSceneBackground renameSceneBackground`,
  colors: `figurePalette editFigureColors setFigureColor replaceFigureColor resetFigureColors addPaletteColor
    addPaletteColors removePaletteColor movePaletteColor`,
  movieclips: `addMovieclipToNextKeyframes createMovieclip createEmptyMovieclip renameMovieclip setMovieclipDrawing
    setMovieclipPlayback restartMovieclip removeMovieclipRestart placeMovieclip splitMovieclip makeMovieclipUnique
    breakApartMovieclip bakeMovieclip enterMovieclip movieclipProjectReport leaveMovieclip sheetExtendMovieclip`,
  effects: `setVfxScope vfxEffects addVfx removeVfx resetVfx duplicateVfx moveVfx reorderVfx pasteVfx setVfxParameter
    applyVfxPreset getVfxClips sampleVfxClip addVfxClip addVfxGroup addVfxUserPreset setVfxClip trimVfxClipStart
    deleteVfxClip moveVfxClipOrder copyVfxClip pasteVfxClip duplicateVfxClip addVfxGroupEffect reorderVfxGroupEffect
    setVfxClipParameter setVfxClipParameters toggleVfxClipKey moveVfxClipKey moveVfxClipKeys deleteVfxClipKeys setVfxClipEasing`,
  audio: `addAudioTrack importAudio setAudioTrack deleteAudioTrack setAudioClip splitAudioClip duplicateAudioClip
    copyAudioClip cutAudioClip pasteAudioClip deleteAudioClip rippleAudio`,
  history: `undo redo`,
  human: `getHumanRig previewHumanMotion applyHumanMotion`,
  cloth: `addCloth getClothMeshes previewClothMotion applyClothMotion`,
  cartoon: `addCartoonCharacter addFilledShape getCharacterView setCharacterView addSpatialScene previewSpatialSceneMotion applySpatialSceneMotion`,
};

// Common tools document positional argument names; other tools link to the native API contract.
const signatures = {
  addFigure: 'figureTypeId?', importFigure: 'document, options?',
  addSegment: 'options?', addSegments: 'segments',
  addPolygon: 'handleIds, options?', updatePolygon: 'index, patch', removePolygon: 'index',
  moveBuilderSegment: 'segmentId, {parentId?, beforeId?}',
  updateFigureStyle: 'patch', updateSegmentStyle: 'patch', updateSegment: 'patch',
  replaceFigureDefinition: 'figureTypeId, definition, options?',
  select: 'uid, jointIndex?, options?', selectMany: 'uids', selectPolygon: 'uid, index',
  moveSelection: 'dx, dy, options?', rotateSelection: 'radians, options?', scaleSelection: 'factor, options?',
  poseJoint: 'x, y, options?', bendJoint: 'x, y, options?', rotateJoint: 'radians, options?',
  addConnector: 'startHandleId, endHandleId, options?', addWeightedJoint: 'originHandleId, anchors',
  setNodeIK: 'patch', setRigBehavior: 'patch', setSpatialPose: 'patch, options?',
  createLayer: 'name, options?', renameLayer: 'id, name', assignFiguresToLayer: 'uids, layerId',
  setLayerVisible: 'id, visible', setLayerLocked: 'id, locked', createLayerFolder: 'name?, layerIds?',
  addAnimationKey: 'target, property, tick, value, options?', addAnimationKeys: 'entries',
  animationValue: 'target, property, tick?, options?', setAnimationKey: 'channelId, keyId, patch',
  moveAnimationKeys: 'selection, deltaTick, options?', setAnimationKeysEasing: 'selection, easing',
  duplicateFrame:'', deleteFrame:'', duplicateFrames:'indices?, options?', deleteFrames:'indices?, label?',
  insertBlankFrame:'index?', bakeFrames:'indices?', moveFrame:'from, to', insertDuplicateFrames:'index, count?, options?',
  pasteFrames:'index?, options?', pasteCamera:'indices?', resetCamera:'indices?', transformCamera:'patch, indices?',
  centerCamera:'indices?, options?', alignCameraToView:'view, indices?', applyCameraToFigures:'indices?',
  setFramesDuration: 'indices, ticks', setFramesEasing: 'indices, easing',
  insertInbetweenFrames: 'ratio?, indices?, options?', insertInbetweenFramesAsync: 'ratio?, indices?, options?',
  selectFrame: 'index', seek: 'tick, options?', setFrameDuration: 'ticks',
  sheetInsertKey: 'layerIds?, tick?, options?', sheetSetEasing: 'layerIds, start, end, easing',
  setCameraValues: 'patch, indices?', addCameraMotion: 'type, options?', setCameraMotion: 'id, patch',
  setSceneColor: 'argb, options?', importSceneBackground: 'background, options?',
  addVfx: 'targets, type', setVfxParameter: 'target, effectId, parameter, value',
  addVfxClip: 'target, type, options?', setVfxClip: 'id, patch',
  createMovieclip: 'options?', enterMovieclip: 'figureTypeId?', leaveMovieclip: 'options?',
  addAudioTrack: 'name?', importAudio: 'asset, options?', setAudioClip: 'id, patch, targetTrackId?',
  setAudioTrack: 'id, patch', splitAudioClip: 'id, timeSeconds?',
  getHumanRig:'mapping?',previewHumanMotion:'options?, sampleTick?',applyHumanMotion:'options?, cancellationOptions?',
  addCloth:'options?',getClothMeshes:'',previewClothMotion:'options?, seconds?',applyClothMotion:'options?, cancellationOptions?',
  addCartoonCharacter:'options?',addFilledShape:'options?',
  getCharacterView:'',setCharacterView:'patch?',
  addSpatialScene:'options?',previewSpatialSceneMotion:'options?, sampleTick?',applySpatialSceneMotion:'options?, cancellationOptions?',
};
const asynchronous = new Set(['insertInbetweenFramesAsync', 'bakeCameraMotion', 'bakeMovieclip','applyHumanMotion','applyClothMotion','applySpatialSceneMotion']);
const signalArguments={insertInbetweenFramesAsync:2,bakeCameraMotion:0,applyHumanMotion:1,applyClothMotion:1,applySpatialSceneMotion:1};
const registry = new Map();
for (const [category, names] of Object.entries(groups)) for (const method of names.trim().split(/\s+/)) {
  if (registry.has(method)) throw new Error(`Duplicate agent method: ${method}`);
  registry.set(method, {method, category, async: asynchronous.has(method), signature: signatures[method],...(Object.hasOwn(signalArguments,method)?{signalArgument:signalArguments[method]}:{})});
}

export const selectionSchema = {type:'object', additionalProperties:false, properties:{
  uid:{type:['integer','null']}, uids:{type:'array',items:{type:'integer'},maxItems:10000},
  jointId:{type:'integer'}, polygonId:{type:'integer'}, layerId:{type:'string'},
}};
export const atSchema = {type:'object', additionalProperties:false, properties:{frame:{type:'integer',minimum:0},tick:{type:'integer',minimum:0}}};
export const callSchema = {type:'object', additionalProperties:false, properties:{
  args:{type:'array',maxItems:16,description:'Native positional arguments; omit optional trailing arguments.'},
  selection:selectionSchema, at:atSchema,
}};

export function agentMethod(method) {
  const entry = registry.get(method);
  if (!entry) throw new Error(`Unknown agent method: ${method}`);
  return entry;
}

// The app's low-level inspector setters assume a typed UI patch. Validate that
// boundary here so JSON cannot change native identities or pose-array topology.
const patchFields={
  updateObject:['root_x','root_y','scale','color_override_raw','field28','image_text_flags','name'],
  updateSelection:['color_override_raw','field28','image_text_flags','name'],
  updateFiguresInFrames:['root_x','root_y','scale','color_override_raw','field28','image_text_flags','name'],
  updateSegment:['color_rgb','thickness','transparency','angle_rad','length','bend_rad','is_static'],
};
export function validateAgentArguments(method,args) {
  const allowed=patchFields[method];if(!allowed)return;
  const patch=args[0];
  if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new TypeError('Expected a property patch.');
  for(const [key,value]of Object.entries(patch)){
    if(!allowed.includes(key))throw new Error(`Use structural editor commands to change ${key}.`);
    if(key==='name'){if(typeof value!=='string'||!value.trim()||value.length>255)throw new TypeError('name must contain 1–255 characters.');}
    else if(key==='color_rgb'){if(!Array.isArray(value)||value.length!==3||value.some(v=>!Number.isInteger(v)||v<0||v>255))throw new TypeError('color_rgb must contain three bytes.');}
    else if(key==='is_static'){if(typeof value!=='boolean')throw new TypeError('is_static must be a boolean.');}
    else{
      if(!Number.isFinite(value))throw new TypeError(`${key} must be finite.`);
      if(['thickness','length','scale'].includes(key)&&value<0)throw new RangeError(`${key} must be nonnegative.`);
      if(['transparency','field28'].includes(key)&&(!Number.isInteger(value)||value<0||value>255))throw new RangeError(`${key} must be a byte.`);
      if(key==='color_override_raw'&&(!Number.isInteger(value)||value<0||value>0xffffffff))throw new RangeError('color_override_raw must be an unsigned 32-bit color.');
      if(key==='image_text_flags'&&!Number.isInteger(value))throw new TypeError('image_text_flags must be an integer.');
    }
  }
}

function nativeSignature(fn) {
  const source=fn.toString(),start=source.indexOf('(');let depth=0,quote='';
  for(let i=start;i<source.length;i++){
    const c=source[i];
    if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue;}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
    if(c==='(')depth++;if(c===')'&&!--depth)return source.slice(start+1,i).replace(/\s+/g,' ');
  }
  return '...nativeArguments';
}

export function editorTools({category, method} = {},prototype) {
  if (method !== undefined) agentMethod(method);
  if (category !== undefined && !Object.hasOwn(groups, category)) throw new Error(`Unknown tool category: ${category}`);
  return [...registry.values()].filter(entry => (!category || entry.category === category) && (!method || entry.method === method))
    .map(entry => {
      const signature=entry.signature??(prototype?nativeSignature(prototype[entry.method]):'...nativeArguments');
      return {name:`editor_${entry.method}`, ...entry,signature,
        description:`${entry.category}: Editor.${entry.method}(${signature}). Uses native commands, validation and history.`,
        inputSchema:{...callSchema,properties:{...callSchema.properties,args:{...callSchema.properties.args,
          description:signature,...(patchFields[entry.method]?{prefixItems:[{type:'object',additionalProperties:false,
            properties:Object.fromEntries(patchFields[entry.method].map(key=>[key,{}]))}]}:{})}}}};
    });
}
