import {createCartoonCharacter,createFilledShape} from './filled-art.mjs';
import {characterView,characterViewPose} from './spatial-character.mjs';

export const editorFilledArtMethods={
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
