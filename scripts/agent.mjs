import {open, rename, unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {AgentEngine} from '../src/agent-engine.mjs';
import {decodeDocument, normalizeDecodedDocument, buildContainerV2} from '../src/native-container.mjs';

const help = `Usage: node scripts/agent.mjs job.json
Job: {version:1, input?:"project.styk", name?:string, commands:[], output?:"project.styk"}
     output may also end in .mp4 or .webm (silent video; requires Playwright Chromium).
Paths are relative to the job file. JSON results go to stdout; errors to stderr.
Operations: inspect, project, addFigure, importFigure, draw, selectFrame, seek, duplicateFrame,
deleteFrame, duration, move, rotate, scale, style, pose, deleteFigure, camera, background, undo, redo.
See docs/AGENT-API.md for command fields and examples.`;

async function readBounded(filename, maxBytes) {
  const file = await open(filename, 'r');
  try {
    const {size} = await file.stat();
    if (size > maxBytes) throw new RangeError(`Input exceeds ${maxBytes} bytes.`);
    // Read at most the limit, even when another process grows the file.
    const chunks = []; let sizeRead = 0;
    for await (const chunk of file.createReadStream({autoClose:false, end:maxBytes})) {
      sizeRead += chunk.length;
      if (sizeRead > maxBytes) throw new RangeError(`Input exceeds ${maxBytes} bytes.`);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, sizeRead);
  } finally { await file.close(); }
}

// A failed/cancelled job never replaces a previous complete output.
export async function atomicOutput(destination, produce, signal) {
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomUUID()}.tmp`);
  const file = await open(temporary, 'wx');
  try {
    let position = 0;
    const writeAt = async (bytes, offset) => {
      let written = 0;
      while (written < bytes.byteLength) {
        signal?.throwIfAborted();
        const result = await file.write(bytes, written, bytes.byteLength - written, offset + written);
        if (!result.bytesWritten) throw new Error('Output write made no progress.');
        written += result.bytesWritten;
      }
    };
    await produce({write: async bytes => { await writeAt(bytes, position); position += bytes.byteLength; }, patch: writeAt});
    signal?.throwIfAborted();
    await file.sync(); await file.close();
    await rename(temporary, destination);
  } finally { await file.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function runJob(job, {directory = process.cwd(), signal} = {}) {
  signal?.throwIfAborted();
  if (!job || job.version !== 1 || !Array.isArray(job.commands)) throw new Error('Expected a version:1 job with commands array.');
  for (const key of Object.keys(job)) if (!['version', 'input', 'name', 'commands', 'output', 'video'].includes(key)) throw new Error(`Unknown job field: ${key}`);
  if (job.commands.length > 10000) throw new RangeError('A job supports at most 10000 commands.');
  for (const key of ['input', 'output', 'name']) if (job[key] !== undefined && (typeof job[key] !== 'string' || !job[key].trim())) throw new TypeError(`${key} must be a nonempty string.`);
  if (job.video !== undefined && (!job.video || typeof job.video !== 'object' || Array.isArray(job.video))) throw new TypeError('video must be an object.');
  for (const key of Object.keys(job.video ?? {})) if (!['start', 'end'].includes(key)) throw new Error(`Unknown video field: ${key}`);
  let document;
  if (job.input) {
    const decoded = await decodeDocument(await readBounded(path.resolve(directory, job.input), 256 * 1024 * 1024), 'styk');
    document = normalizeDecodedDocument(decoded.document, 'styk');
  }
  const engine = new AgentEngine({document, ...(job.name ? {name: job.name} : {})});
  for (const [index, command] of job.commands.entries()) {
    signal?.throwIfAborted();
    try { engine.execute(command); }
    catch (error) { throw new Error(`Command ${index} (${command?.op ?? '?'}): ${error.message}`, {cause: error}); }
  }
  const result = engine.inspect();
  if (job.output) {
    const destination = path.resolve(directory, job.output), format = path.extname(destination).slice(1).toLowerCase();
    if (!['styk', 'mp4', 'webm'].includes(format)) throw new Error('Output must be .styk, .mp4 or .webm.');
    const report = engine.snapshot();
    await atomicOutput(destination, async sink => {
      if (format === 'styk') await sink.write(await buildContainerV2(report, 'styk'));
      else {
        const options = job.video ?? {};
        const start = options.start ?? 0, end = options.end ?? result.totalTicks;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > result.totalTicks) throw new RangeError('Video range must be [start, end) within the animation.');
        const {renderAgentVideo} = await import('./agent-video.mjs');
        await renderAgentVideo(report, {format, start, end, browserPath: process.env.STYK_BROWSER_PATH, signal,
          write: sink.write, patch: (offset, bytes) => sink.patch(bytes, offset)});
      }
    }, signal);
    result.output = destination;
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || ['--help', '-h'].includes(process.argv[2])) {
    console.log(help); process.exitCode = process.argv.length === 3 ? 0 : 1;
  } else {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    try {
      const filename = path.resolve(process.argv[2]);
      const result = await runJob(JSON.parse((await readBounded(filename, 16 * 1024 * 1024)).toString('utf8')), {directory: path.dirname(filename), signal: controller.signal});
      console.log(JSON.stringify({ok: true, ...result}));
    } catch (error) {
      console.error(JSON.stringify({ok: false, error: error.message})); process.exitCode = 1;
    } finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
  }
}
