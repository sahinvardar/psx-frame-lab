importScripts('vendor/fzstd.js','engine.js');
let dump,gpu,checkpoints=[],stride=128,enhanced=null,renderTarget='draw';
function serialize(c){const {w,...rest}=c;return {...rest,wordCount:w.length,raw:Array.from(w.subarray(0,32),PSX.hex)};}
function stateMessage(type,extras={}){if(enhanced&&type==='frame'){enhanced.seek(extras.n);extras.high=enhanced.crop(renderTarget);}const pixels=gpu.rgba(),raw=gpu.vram.slice();postMessage({type,pixels,raw,state:PSX.clone(gpu.state),...extras},[pixels.buffer,raw.buffer]);}
onmessage=async({data:m})=>{try{
 if(m.type==='load'){
  let bytes=new Uint8Array(m.buffer);if(bytes.length>64*1024*1024)throw Error('File exceeds the 64 MB limit.');
  if(bytes[0]===0x28&&bytes[1]===0xb5&&bytes[2]===0x2f&&bytes[3]===0xfd){let chunks=[],length=0;const dec=new fzstd.Decompress(chunk=>{length+=chunk.length;if(length>64*1024*1024)throw Error('Decompressed dump exceeds 64 MB.');chunks.push(chunk.slice());});dec.push(bytes,true);bytes=new Uint8Array(length);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}}
  postMessage({type:'progress',text:'Decoding GPU commands…'});enhanced=null;dump=PSX.parse(bytes);gpu=new PSX.GPU();checkpoints=[];
  for(const c of dump.setup)gpu.apply(c,true);checkpoints.push({at:0,snapshot:gpu.snapshot()});
  stride=Math.max(128,Math.ceil(dump.commands.length/48));let textureRaw=null;
  for(let i=0;i<dump.commands.length;i++){if(i===dump.commands.length-1&&dump.commands[i].clut)textureRaw=gpu.vram.slice();gpu.apply(dump.commands[i],true);if((i+1)%stride===0)checkpoints.push({at:i+1,snapshot:gpu.snapshot()});if(i%256===0)postMessage({type:'progress',text:'Replaying '+i.toLocaleString()+' / '+dump.commands.length.toLocaleString()+' commands…'});}
  const unsupported=[];if(gpu.state.display24)unsupported.push('24-bit display mode: frame preview uses 15-bit VRAM colors.');if(gpu.state.interlace)unsupported.push('Interlaced output is shown without field timing.');
  stateMessage('loaded',{textureRaw,info:dump.info,warnings:[...dump.warnings,...unsupported],commands:dump.commands.map(serialize),setup:dump.setup.map(serialize),bytes:dump.bytes,packets:dump.packets});
 }else if(m.type==='resolution'&&dump){renderTarget=m.target||'draw';const scale=[1,2,4].includes(m.scale)?m.scale:1;postMessage({type:'progress',text:'Rendering at '+scale+'× resolution…'});enhanced=scale>1?new PSX.EnhancedReplay(dump,scale):null;let finalHigh=null,high=null;if(enhanced){enhanced.seek(dump.commands.length);finalHigh=enhanced.crop(renderTarget);enhanced.seek(m.n);high=enhanced.crop(renderTarget);}postMessage({type:'resolution',scale,high,finalHigh});
 }else if(m.type==='seek'&&dump){let n=Math.max(0,Math.min(dump.commands.length,m.n));const textured=n>0&&dump.commands[n-1].clut;let textureRaw=null;let cp=checkpoints[0];for(const c of checkpoints)if(c.at<=(textured?n-1:n))cp=c;else break;gpu.restore(cp.snapshot);for(let i=cp.at;i<n;i++){if(textured&&i===n-1)textureRaw=gpu.vram.slice();gpu.apply(dump.commands[i]);}stateMessage('frame',{n,request:m.request,textureRaw});}
}catch(e){postMessage({type:'error',text:e.message||String(e)});}};
