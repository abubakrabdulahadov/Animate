import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AgentEngine} from '../src/agent-engine.mjs';
import {readBounded,readProject,writeProjectOutput} from './agent-files.mjs';
export {atomicOutput} from './agent-files.mjs';

const help = `Usage: node scripts/agent.mjs job.json
       node scripts/agent.mjs --stdio
       node scripts/agent.mjs --tools [category]
Job: {version:1, input?:"project.styk", name?:string, commands:[], output?:"project.styk"}
     output may also end in .mp4, .webm, .png or .svg (requires Playwright Chromium).
Paths are relative to the job file. JSON results go to stdout; errors to stderr.
Advanced operations: tools, query, snapshot, validate, call (native Editor methods).
Legacy operations: inspect, project, addFigure, importFigure, draw, selectFrame, seek, duplicateFrame,
deleteFrame, duration, move, rotate, scale, style, pose, deleteFigure, camera, background, undo, redo.
See docs/AGENT-API.md for command fields and examples.`;

export async function runJob(job, {directory = process.cwd(), signal} = {}) {
  signal?.throwIfAborted();
  if (!job || job.version !== 1 || !Array.isArray(job.commands)) throw new Error('Expected a version:1 job with commands array.');
  for (const key of Object.keys(job)) if (!['version', 'input', 'name', 'commands', 'output', 'video'].includes(key)) throw new Error(`Unknown job field: ${key}`);
  if (job.commands.length > 10000) throw new RangeError('A job supports at most 10000 commands.');
  for (const key of ['input', 'output', 'name']) if (job[key] !== undefined && (typeof job[key] !== 'string' || !job[key].trim())) throw new TypeError(`${key} must be a nonempty string.`);
  if (job.video !== undefined && (!job.video || typeof job.video !== 'object' || Array.isArray(job.video))) throw new TypeError('video must be an object.');
  for (const key of Object.keys(job.video ?? {})) if (!['start','end','tick','width','height','smoothing','audio'].includes(key)) throw new Error(`Unknown video field: ${key}`);
  let document;
  if (job.input) {
    document = await readProject(path.resolve(directory,job.input));
  }
  const engine = new AgentEngine({document, ...(job.name ? {name: job.name} : {})});
  let lastResult;
  for (const [index, command] of job.commands.entries()) {
    signal?.throwIfAborted();
    try { lastResult = await engine.executeAsync(command); }
    catch (error) { throw new Error(`Command ${index} (${command?.op ?? '?'}): ${error.message}`, {cause: error}); }
  }
  const result = engine.inspect();
  if (job.output) {
    const destination = path.resolve(directory,job.output);
    await writeProjectOutput(engine,destination,job.video??{},signal);
    result.output = destination;
  }
  if (['tools','query','snapshot','validate','call'].includes(job.commands.at(-1)?.op)) result.result=lastResult;
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length < 3 || ['--help', '-h'].includes(process.argv[2])) {
    console.log(help); process.exitCode = process.argv.length >= 3 ? 0 : 1;
  } else {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    try {
      if(process.argv[2]==='--stdio'){
        if(process.argv.length!==3)throw new Error('Use --stdio without additional arguments.');
        const {serveAgent}=await import('./agent-session.mjs');
        const stopInput=()=>process.stdin.destroy();controller.signal.addEventListener('abort',stopInput,{once:true});
        try{await serveAgent({signal:controller.signal});}finally{controller.signal.removeEventListener('abort',stopInput);}
      }else if(process.argv[2]==='--tools'){
        if(process.argv.length>4)throw new Error('Use --tools [category].');
        const {AgentSession,agentJSON}=await import('./agent-session.mjs');
        console.log(agentJSON({ok:true,tools:new AgentSession().tools(process.argv[3]?{category:process.argv[3]}:{})}));
      }else{
        if(process.argv.length!==3)throw new Error('Expected one job filename.');
        const filename = path.resolve(process.argv[2]);
        const result = await runJob(JSON.parse((await readBounded(filename, 16 * 1024 * 1024)).toString('utf8')), {directory: path.dirname(filename), signal: controller.signal});
        const {agentJSON}=await import('./agent-session.mjs');console.log(agentJSON({ok:true,...result}));
      }
    } catch (error) {
      console.error(JSON.stringify({ok: false, error: error.message})); process.exitCode = 1;
    } finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
  }
}
