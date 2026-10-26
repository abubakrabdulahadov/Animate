export function spatialLight(input={},base={direction:[-.6,-1,.5],ambient:.45,intensity:.8,color:[255,239,218]}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['direction','ambient','intensity','color'].includes(k)))throw new TypeError('Lighting needs direction, ambient, intensity and RGB color.');
 const out={...base,...input},v=out.direction;
 if(!Array.isArray(v)||v.length!==3||![0,1,2].every(i=>Number.isFinite(v[i]))||!Number.isFinite(Math.hypot(...v))||Math.hypot(...v)<1e-6)throw new TypeError('Light direction must be a finite nonzero XYZ vector.');
 out.direction=v.map(n=>n/Math.hypot(...v));
 for(const [key,max]of [['ambient',1],['intensity',2]])if(!Number.isFinite(out[key])||out[key]<0||out[key]>max)throw new RangeError(`Light ${key} must be between zero and ${max}.`);
 if(!Array.isArray(out.color)||out.color.length!==3||![0,1,2].every(i=>Number.isInteger(out.color[i])&&out.color[i]>=0&&out.color[i]<=255))throw new TypeError('Light color needs RGB bytes.');out.color=[...out.color];return out;
}
export function interpolateLight(a,b,t){
 if(!a&&!b)return undefined;const x=spatialLight(a??{...b,intensity:0,ambient:1}),y=spatialLight(b??{...a,intensity:0,ambient:1});
 const dot=Math.max(-1,Math.min(1,x.direction.reduce((n,v,i)=>n+v*y.direction[i],0)));let direction;
 if(dot<-.9995){const v=x.direction,p=Math.abs(v[1])<.9?[v[2],0,-v[0]]:[0,-v[2],v[1]],norm=Math.hypot(...p);direction=v.map((n,i)=>n*Math.cos(Math.PI*t)+p[i]/norm*Math.sin(Math.PI*t));}
 else if(dot>.9995)direction=x.direction.map((n,i)=>n+(y.direction[i]-n)*t);
 else{const a=Math.acos(dot),s=Math.sin(a);direction=x.direction.map((n,i)=>(n*Math.sin((1-t)*a)+y.direction[i]*Math.sin(t*a))/s);}
 return spatialLight({direction,ambient:Math.max(0,Math.min(1,x.ambient+(y.ambient-x.ambient)*t)),intensity:Math.max(0,Math.min(2,x.intensity+(y.intensity-x.intensity)*t)),color:x.color.map((n,i)=>Math.round(Math.max(0,Math.min(255,n+(y.color[i]-n)*t))))});
}
export function litColor(rgb,light,diffuse){const level=Math.round(Math.max(0,Math.min(1,diffuse))*15)/15;return rgb.map((n,i)=>Math.round(Math.max(0,Math.min(255,n*(light.ambient+light.intensity*level*light.color[i]/255)))));}
