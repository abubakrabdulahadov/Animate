import {createSpatialScene,createSpatialSceneMotion} from './spatial-scene.mjs';
import {createObject,createFrame} from './demo.mjs';
import {poseMotionContext,applyPoseMotion} from './editor-human-motion.mjs';
import {prepareHumanMotion} from './human-motion-client.mjs';
import {createCartoonCharacter,createFilledShape} from './filled-art.mjs';
import {characterView,characterViewPose} from './spatial-character.mjs';

export const editorFilledArtMethods={
  addSpatialScene(options={}){
    const {position,camera,...style}=options,figure=createSpatialScene(style);
    const pose=createSpatialSceneMotion(figure,createObject(figure,1,0,0),{duration:2,camera}).sample(0).pose;
    const object=this.importFigure({figure_types:[figure],keyframes:[createFrame([pose])]},{position});
    return {uid:object.unique_id,figureTypeId:object.figure_type_id,actors:figure._styk.spatialScene.actors.map((a,index)=>({index,name:a.name}))};
  },
  previewSpatialSceneMotion(options={},tick=0){
    const c=poseMotionContext(this,options,false,false);return createSpatialSceneMotion(c.input.figure,c.input.object,options,c.input.fps).sample(tick);
  },
  async applySpatialSceneMotion(options={}, {signal}={}){
    return applyPoseMotion(this,options,{signal,humanoid:false,label:'Animate spatial scene',prepare:(input,control)=>prepareHumanMotion({...input,kind:'spatialScene'},control)});
  },
  addCartoonCharacter(options={}){
    const {position,...style}=options,{figure,rig}=createCartoonCharacter(style);
    const object=this.importFigure(figure,{position});return {uid:object.unique_id,figureTypeId:object.figure_type_id,rig};
  },
  addFilledShape(options={}){
    const {position,...style}=options;
    return this.importFigure(createFilledShape(style),{position});
  },
  getCharacterView(){if(!this.object)throw new Error('Select a character.');return characterView(this.figure,this.object);},
  setCharacterView(patch={}){
    if(!this.object)throw new Error('Select a character.');
    const pose=characterViewPose(this.figure,this.object,patch);
    return this._objectEdit('Change character view',o=>{Object.assign(o,pose);delete o.runtime_segments;},{posed:true});
  },
};
