import {createCartoonCharacter,createFilledShape} from './filled-art.mjs';

export const editorFilledArtMethods={
  addCartoonCharacter(options={}){
    const {position,...style}=options,{figure,rig}=createCartoonCharacter(style);
    const object=this.importFigure(figure,{position});return {uid:object.unique_id,figureTypeId:object.figure_type_id,rig};
  },
  addFilledShape(options={}){
    const {position,...style}=options;
    return this.importFigure(createFilledShape(style),{position});
  },
};
