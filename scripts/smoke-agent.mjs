import assert from 'node:assert/strict';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runJob} from './agent.mjs';

const directory = fileURLToPath(new URL('../artifacts/agent-smoke/', import.meta.url));
await mkdir(directory, {recursive:true});
const commands = [{op:'project',width:320,height:240,fps:12}, {op:'addFigure'},
  {op:'scale',uid:1,factor:0.4}, {op:'move',uid:1,dx:-80,dy:0}];
for (let i = 0; i < 11; i++) commands.push({op:'duplicateFrame'}, {op:'move',uid:1,dx:12,dy:0});
await runJob({version:1,commands,output:'scene.styk'}, {directory});
const results = [];
for (const format of ['webm', 'mp4']) {
  const filename = path.join(directory, `animation.${format}`);
  await runJob({version:1,input:'scene.styk',commands:[],output:filename}, {directory});
  const probe = JSON.parse(execFileSync('ffprobe', ['-v','error','-count_frames','-show_streams','-of','json',filename], {encoding:'utf8'}));
  const stream = probe.streams.find(s => s.codec_type === 'video');
  assert.equal(stream.width, 320); assert.equal(stream.height, 240);
  assert.equal(Number(stream.nb_read_frames), 12); assert.equal(stream.r_frame_rate, '12/1');
  // Decode the actual first/last encoded frames and check that the figure moved.
  const pixels = execFileSync('ffmpeg', ['-v','error','-i',filename,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'], {maxBuffer:10*1024*1024});
  const frameSize = 320*240*3;
  const center = index => {
    let sum = 0, count = 0;
    for (let pixel=0; pixel<320*240; pixel++) {
      const offset = index*frameSize+pixel*3;
      if (pixels[offset]<100 && pixels[offset+1]<100 && pixels[offset+2]<100) {sum+=pixel%320; count++;}
    }
    assert.ok(count>50, 'Decoded video must contain visible artwork.');
    return sum/count;
  };
  assert.ok(center(11)-center(0)>100, 'Encoded artwork must move across the stage.');
  // Keep a decoded frame for visual inspection.
  execFileSync('ffmpeg', ['-v','error','-y','-i',filename,'-frames:v','1',path.join(directory,`${format}-first.png`)]);
  results.push({format,codec:stream.codec_name,frames:Number(stream.nb_read_frames),firstX:center(0),lastX:center(11),bytes:(await readFile(filename)).length});
}
await writeFile(path.join(directory, 'report.json'), JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
