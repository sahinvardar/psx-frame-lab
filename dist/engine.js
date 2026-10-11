/* PS1 command decoding and an inspectable software rasterizer. No game CPU emulation. */
(function(root){
'use strict';
const W=1024,H=512, MAX_COMMANDS=100000;
const sx=(v,n)=>((v&((1<<n)-1))^(1<<(n-1)))-(1<<(n-1));
const xy=v=>[sx(v,11),sx(v>>>16,11)];
const rgb=v=>[v&255,(v>>>8)&255,(v>>>16)&255];
const dim=v=>[((v&65535)-1&1023)+1,((v>>>16)-1&511)+1];
const hex=v=>(v>>>0).toString(16).padStart(8,'0').toUpperCase();
const mode=v=>({x:(v&15)*64,y:((v>>>4)&1)*256,depth:(v>>>7)&3,blend:(v>>>5)&3});
function parse(bytes){
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),str=new TextDecoder();
 let head=str.decode(bytes.subarray(0,16)),p;
 if(head.startsWith('PSXGPUDUMPv1r1\0\0'))p=16;
 else if(head.startsWith('PSXGPUDUMPv1\0\0'))p=14;
 else throw Error('Not a supported PSX GPU dump. Expected DuckStation v1 or standard v1r1.');
 const legacy=p===14, packets=[],info={},warnings=[];let trace=Infinity,frame=0,total=0;
 while(p<bytes.length){
  if(p+4>bytes.length)throw Error('Truncated packet header.');
  const offset=p,h=d.getUint32(p,true),len=h&0xffffff,type=h>>>24;p+=4;
  if(p+len*4>bytes.length)throw Error('Truncated packet at 0x'+offset.toString(16));
  const words=new Uint32Array(len);for(let i=0;i<len;i++)words[i]=d.getUint32(p+i*4,true);
  if(type===5){if(trace!==Infinity)throw Error('Multiple trace-start markers are not supported.');trace=offset;frame=1;}
  packets.push({offset,dataOffset:p,type,words,frame});
  if(type===0)total+=len;
  if(type===2)frame++;
  if([16,17,18].includes(type))info[{16:'game',17:'video',18:'recorder'}[type]]=str.decode(bytes.subarray(p,p+len*4)).split('\0')[0];
  if(![0,1,2,3,4,5,6,16,17,18].includes(type))warnings.push('Skipped unknown packet type '+type);
  p+=len*4;
 }
 if(trace===Infinity)throw Error('Missing trace-start marker.');
 const stream=new Uint32Array(total),origins=[];let pos=0;
 for(const q of packets)if(q.type===0){stream.set(q.words,pos);origins.push({start:pos,end:pos+q.words.length,q});pos+=q.words.length;}
 const all=[];let k=0,oi=0;
 const ensure=n=>{if(k+n>stream.length)throw Error('Incomplete GP0 command at word '+k);};
 while(k<stream.length){
  while(oi<origins.length-1&&k>=origins[oi].end)oi++;
  const origin=origins[oi],q=origin.q,offset=q.dataOffset+(k-origin.start)*4,op=stream[k]>>>24;
  let n=1,name='',kind='state',v=[],page=null,clut=null;const w0=stream[k];
  if(op>=0x20&&op<0x40){
   const nv=op&8?4:3,tex=!!(op&4),g=!!(op&16);n=1+nv*(1+Number(tex))+(nv-1)*Number(g);ensure(n);
   name=(g?'Gouraud':'Flat')+(tex?' textured':' untextured')+(nv===4?' quad':' triangle');kind='polygon';let j=k+1,c=rgb(w0);
   for(let a=0;a<nv;a++){if(g&&a)c=rgb(stream[j++]);let vv={xy:xy(stream[j++]),rgb:c};if(tex){const t=stream[j++];vv.uv=[t&255,t>>>8&255];if(a===0)clut=[(t>>>16&63)*16,t>>>22&511];if(a===1)page=mode(t>>>16);}v.push(vv);}
  }else if(op>=0x40&&op<0x60){
   const g=!!(op&16),poly=!!(op&8);n=g?4:3;ensure(n);
   if(poly){for(;;){ensure(n+1);if((stream[k+n]&0xf000f000)===0x50005000){n++;break;}n+=g?2:1;}}
   name=(g?'Gouraud':'Flat')+(poly?' polyline':' line');kind='line';let j=k+1,c=rgb(w0),end=k+n-(poly?1:0);while(j<end){if(g&&v.length)c=rgb(stream[j++]);v.push({xy:xy(stream[j++]),rgb:c});}
  }else if(op>=0x60&&op<0x80){
   const tex=!!(op&4),size=op>>>3&3;n=2+Number(tex)+Number(size===0);ensure(n);name=(tex?'Textured':'Untextured')+' rectangle';kind='rectangle';v=[{xy:xy(stream[k+1]),rgb:rgb(w0)}];if(tex){let t=stream[k+2];v[0].uv=[t&255,t>>>8&255];clut=[(t>>>16&63)*16,t>>>22&511];}
  }else if(op>=0x80&&op<0xa0){n=4;name='VRAM → VRAM copy';kind='transfer';}
  else if(op>=0xa0&&op<0xe0){ensure(3);const [x,y]=dim(stream[k+2]);n=3+(op<0xc0?Math.ceil(x*y/2):0);name=op<0xc0?'CPU → VRAM upload':'VRAM → CPU read';kind='transfer';}
  else if(op===2){n=3;name='Fill VRAM';kind='fill';}
  else if(op>=0xe1&&op<=0xe6)name=['Set draw mode','Set texture window','Drawing area · top-left','Drawing area · bottom-right','Set drawing offset','Set mask behavior'][op-0xe1];
  else if(op===1)name='Clear texture cache';else if(op===0x1f)name='Request GPU interrupt';
  else if(op<=0x1e||op===0xe0||(op>=0xe7&&op<0xf0))name='NOP / unused';
  else throw Error('Unsupported GP0 opcode 0x'+op.toString(16)+' at 0x'+offset.toString(16));
  ensure(n);all.push({offset,frame:q.frame,setup:offset<trace,port:'GP0',op,name,kind,v,page,clut,semi:!!(op&2),rawTexture:!!(op&1),w:stream.subarray(k,k+n)});k+=n;
  if(all.length>MAX_COMMANDS)throw Error('Dump exceeds the 100,000-command limit.');
 }
 const names=['Reset GPU','Reset command buffer','Acknowledge interrupt','Set display enable','Set DMA direction','Set display start','Set horizontal range','Set vertical range','Set display mode','Allow texture disable'];
 for(const q of packets){
  if(q.type===1)q.words.forEach((w,j)=>{let op=w>>>24&63;all.push({offset:q.dataOffset+j*4,frame:q.frame,setup:q.offset<trace,port:'GP1',op,name:names[op]||'GPU control',kind:'control',w:Uint32Array.of(w)});});
  else if([2,3,4].includes(q.type))all.push({offset:q.offset,frame:q.frame,setup:q.offset<trace,port:'Event',op:q.type,name:{2:'VSync',3:'Discard readback',4:'Readback'}[q.type],kind:'event',w:q.words});
 }
 all.sort((a,b)=>a.offset-b.offset);all.forEach((c,i)=>c.index=i);
 return {info,warnings,legacy,all,setup:all.filter(c=>c.setup),commands:all.filter(c=>!c.setup),bytes:bytes.length,packets:packets.length};
}
function initial(){return {area:[0,0,1023,511],offset:[0,0],page:mode(0),window:[0,0,0,0],maskSet:false,maskCheck:false,dither:false,flipX:false,flipY:false,display:[0,0],resolution:[320,240],interlace:false,display24:false,displayDisabled:false};}
const clone=o=>JSON.parse(JSON.stringify(o));
class GPU{
 constructor(){this.vram=new Uint16Array(W*H);this.state=initial();}
 snapshot(){return {vram:this.vram.slice(),state:clone(this.state)};}
 restore(s){this.vram.set(s.vram);this.state=clone(s.state);}
 tex(u,v,page,clut){const t=this.state.window;u=((u&255)&~(t[0]*8))|((t[2]&t[0])*8);v=((v&255)&~(t[1]*8))|((t[3]&t[1])*8);let p;
  if(page.depth===0){const w=this.vram[((page.y+v)&511)*W+((page.x+(u>>2))&1023)];const idx=w>>((u&3)*4)&15;p=this.vram[(clut[1]&511)*W+((clut[0]+idx)&1023)];}
  else if(page.depth===1){const w=this.vram[((page.y+v)&511)*W+((page.x+(u>>1))&1023)];const idx=w>>((u&1)*8)&255;p=this.vram[(clut[1]&511)*W+((clut[0]+idx)&1023)];}
  else p=this.vram[((page.y+v)&511)*W+((page.x+u)&1023)];return p;
 }
 put(x,y,color,c,u=0,v=0){
  const s=this.state;if(x<s.area[0]||x>s.area[2]||y<s.area[1]||y>s.area[3]||x<0||x>=(this.rasterWidth||W)||y<0||y>=(this.rasterHeight||H))return;
  const at=y*(this.rasterWidth||W)+x,old=this.vram[at];if(s.maskCheck&&(old&32768))return;
  let rr=color[0],gg=color[1],bb=color[2],alpha=false,tex=!!c.clut;
  if(tex){let t=this.tex(Math.floor(u),Math.floor(v),c.page||s.page,c.clut);if(t===0)return;alpha=!!(t&32768);let tr=t&31,tg=t>>5&31,tb=t>>10&31;if(c.rawTexture){rr=tr*8;gg=tg*8;bb=tb*8;}else{rr=tr*rr/16;gg=tg*gg/16;bb=tb*bb/16;}}
  const dt=s.dither&&c.kind==='polygon'&&!c.rawTexture?[-4,0,-3,1,2,-2,3,-1,-3,1,-4,0,3,-1,2,-2][(y&3)*4+(x&3)]:0;
  let r=Math.max(0,Math.min(31,Math.floor((rr+dt)/8))),g=Math.max(0,Math.min(31,Math.floor((gg+dt)/8))),b=Math.max(0,Math.min(31,Math.floor((bb+dt)/8)));
  if(c.semi&&(!tex||alpha)){const m=(c.page||s.page).blend;const blend=(a,z)=>m===0?(a+z)>>1:m===1?Math.min(31,a+z):m===2?Math.max(0,a-z):Math.min(31,a+(z>>2));r=blend(old&31,r);g=blend(old>>5&31,g);b=blend(old>>10&31,b);}
  this.vram[at]=r|(g<<5)|(b<<10)|((s.maskSet||alpha)?32768:0);
 }
 triangle(aa,bb,cc,c){
  const s=this.state,convert=v=>({...v,x:v.xy[0]+s.offset[0],y:v.xy[1]+s.offset[1]});let a=convert(aa),b=convert(bb),d=convert(cc);
  const edge=(p,q,x,y)=>(q.x-p.x)*(y-p.y)-(q.y-p.y)*(x-p.x);let area=edge(a,b,d.x,d.y);if(!area)return;if(area<0){[b,d]=[d,b];area=-area;}
  const minX=Math.max(0,s.area[0],Math.min(a.x,b.x,d.x)),maxX=Math.min((this.rasterWidth||W)-1,s.area[2],Math.max(a.x,b.x,d.x)-1),minY=Math.max(0,s.area[1],Math.min(a.y,b.y,d.y)),maxY=Math.min((this.rasterHeight||H)-1,s.area[3],Math.max(a.y,b.y,d.y)-1);
  if(Math.max(a.x,b.x,d.x)-Math.min(a.x,b.x,d.x)>1023*(this.renderScale||1)||Math.max(a.y,b.y,d.y)-Math.min(a.y,b.y,d.y)>511*(this.renderScale||1))return;
  const tl=(p,q)=>(q.y-p.y)<0||((q.y===p.y)&&(q.x>p.x));let t0=tl(b,d),t1=tl(d,a),t2=tl(a,b),tex=!!c.clut;
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
   let e0=edge(b,d,x+.5,y+.5),e1=edge(d,a,x+.5,y+.5),e2=edge(a,b,x+.5,y+.5);if(e0<0||e1<0||e2<0||(e0===0&&!t0)||(e1===0&&!t1)||(e2===0&&!t2))continue;
   let f=e0/area,g=e1/area,h=e2/area,col=[0,1,2].map(i=>a.rgb[i]*f+b.rgb[i]*g+d.rgb[i]*h);let u=0,v=0;if(tex){u=a.uv[0]*f+b.uv[0]*g+d.uv[0]*h;v=a.uv[1]*f+b.uv[1]*g+d.uv[1]*h;}this.put(x,y,col,c,u,v);
  }
 }
 apply(c,annotate=false){
  const w=c.w,op=c.op,s=this.state;
  if(c.port==='Event')return;
  if(c.port==='GP1'){
   if(op===0)this.state=initial();if(op===3)s.displayDisabled=!!(w[0]&1);if(op===5)s.display=[w[0]&1023,w[0]>>>10&511];
   if(op===8){s.resolution=[w[0]&64?368:[256,320,512,640][w[0]&3],w[0]&4?480:240];s.display24=!!(w[0]&16);s.interlace=!!(w[0]&32);}return;
  }
  if(c.kind==='polygon'||c.kind==='rectangle'||c.kind==='line'){
   if(c.page)s.page={...c.page};else if(c.clut)c.page={...s.page};
   if(annotate){c.drawOffset=[...s.offset];c.drawArea=[...s.area];c.textureWindow=[...s.window];c.textureFlip=[s.flipX,s.flipY];}
   if(c.kind==='polygon'){this.triangle(c.v[0],c.v[1],c.v[2],c);if(c.v.length===4)this.triangle(c.v[1],c.v[2],c.v[3],c);}
   else if(c.kind==='rectangle'){
    const sz=op>>>3&3,[ww,hh]=sz===0?[w[w.length-1]&1023,w[w.length-1]>>>16&511]:{1:[1,1],2:[8,8],3:[16,16]}[sz],a=c.v[0];if(annotate)c.size=[ww,hh];
    for(let y=0;y<hh;y++)for(let x=0;x<ww;x++)this.put(a.xy[0]+s.offset[0]+x,a.xy[1]+s.offset[1]+y,a.rgb,c,(a.uv?.[0]||0)+(s.flipX?-x:x),(a.uv?.[1]||0)+(s.flipY?-y:y));
   }else for(let j=1;j<c.v.length;j++){let a=c.v[j-1],b=c.v[j],dx=b.xy[0]-a.xy[0],dy=b.xy[1]-a.xy[1],n=Math.max(Math.abs(dx),Math.abs(dy));if(n>1023)continue;for(let t=0;t<=n;t++){let f=n?t/n:0;this.put(Math.round(a.xy[0]+dx*f)+s.offset[0],Math.round(a.xy[1]+dy*f)+s.offset[1],a.rgb.map((v,i)=>v+(b.rgb[i]-v)*f),c);}}
  }else if(op===2){const x=w[1]&1008,y=w[1]>>>16&511,ww=((w[2]&1023)+15)&~15,hh=w[2]>>>16&511,col=rgb(w[0]),value=(col[0]>>3)|((col[1]>>3)<<5)|((col[2]>>3)<<10);for(let j=0;j<hh;j++)for(let i=0;i<ww;i++)this.vram[((y+j)&511)*W+((x+i)&1023)]=value;}
  else if(op>=0x80&&op<0xc0){const upload=op>=0xa0,src=w[1],dst=upload?w[1]:w[2],[ww,hh]=dim(w[upload?2:3]);const restoringSnapshot=upload&&c.setup===true;let copy=upload?null:new Uint16Array(ww*hh);if(copy)for(let y=0;y<hh;y++)for(let x=0;x<ww;x++)copy[y*ww+x]=this.vram[(((src>>>16)+y)&511)*W+(((src&1023)+x)&1023)];for(let y=0;y<hh;y++)for(let x=0;x<ww;x++){let i=y*ww+x,at=(((dst>>>16)+y)&511)*W+(((dst&1023)+x)&1023);if(!restoringSnapshot&&s.maskCheck&&(this.vram[at]&32768))continue;let value=upload?(w[3+(i>>1)]>>>((i&1)*16))&65535:copy[i];this.vram[at]=value|(!restoringSnapshot&&s.maskSet?32768:0);}}
  else if(op===0xe1){s.page=mode(w[0]);s.dither=!!(w[0]&512);s.flipX=!!(w[0]&4096);s.flipY=!!(w[0]&8192);}
  else if(op===0xe2)s.window=[w[0]&31,w[0]>>>5&31,w[0]>>>10&31,w[0]>>>15&31];
  else if(op===0xe3){s.area[0]=w[0]&1023;s.area[1]=w[0]>>>10&511;}
  else if(op===0xe4){s.area[2]=w[0]&1023;s.area[3]=w[0]>>>10&511;}
  else if(op===0xe5)s.offset=[sx(w[0],11),sx(w[0]>>>11,11)];
  else if(op===0xe6){s.maskSet=!!(w[0]&1);s.maskCheck=!!(w[0]&2);}
 }
 rgba(){const out=new Uint8ClampedArray(W*H*4);for(let i=0;i<this.vram.length;i++){let v=this.vram[i];out[i*4]=(v&31)*255/31;out[i*4+1]=(v>>5&31)*255/31;out[i*4+2]=(v>>10&31)*255/31;out[i*4+3]=255;}return out;}
}
// Enhanced output is separate from native VRAM, which remains the texture source.
class EnhancedReplay {
 constructor(dump,scale){this.dump=dump;this.scale=scale;this.native=new GPU();this.render=new GPU();this.render.rasterWidth=W*scale;this.render.rasterHeight=H*scale;this.render.renderScale=scale;this.render.vram=new Uint16Array(W*H*scale*scale);this.render.tex=(...args)=>this.native.tex(...args);this.at=0;for(const c of dump.setup)this.native.apply(c);this.syncRect(0,0,W,H);this.points=[this.snapshot()];this.stride=Math.max(128,Math.ceil(dump.commands.length/3));}
 syncRect(x,y,w,h){const s=this.scale,rw=W*s;for(let j=0;j<h;j++)for(let i=0;i<w;i++){const xx=(x+i)&1023,yy=(y+j)&511,v=this.native.vram[yy*W+xx];for(let dy=0;dy<s;dy++)this.render.vram.fill(v,(yy*s+dy)*rw+xx*s,(yy*s+dy)*rw+xx*s+s);}}
 snapshot(){return {at:this.at,native:this.native.snapshot(),pixels:this.render.vram.slice()};}
 restore(p){this.at=p.at;this.native.restore(p.native);this.render.vram.set(p.pixels);}
 apply(c){const s=this.scale,w=c.w;this.render.state=clone(this.native.state);const state=this.render.state;state.area=[state.area[0]*s,state.area[1]*s,(state.area[2]+1)*s-1,(state.area[3]+1)*s-1];state.offset=state.offset.map(v=>v*s);if(c.page)state.page={...c.page};
 if(c.kind==='polygon'){const v=c.v.map(v=>({...v,xy:v.xy.map(x=>x*s)}));this.render.triangle(v[0],v[1],v[2],c);if(v.length===4)this.render.triangle(v[1],v[2],v[3],c);}
 else if(c.kind==='rectangle'){const sz=c.op>>>3&3,[ww,hh]=sz===0?[w[w.length-1]&1023,w[w.length-1]>>>16&511]:{1:[1,1],2:[8,8],3:[16,16]}[sz],a=c.v[0];for(let y=0;y<hh*s;y++)for(let x=0;x<ww*s;x++)this.render.put(a.xy[0]*s+state.offset[0]+x,a.xy[1]*s+state.offset[1]+y,a.rgb,c,(a.uv?.[0]||0)+(state.flipX?-Math.floor(x/s):Math.floor(x/s)),(a.uv?.[1]||0)+(state.flipY?-Math.floor(y/s):Math.floor(y/s)));}
 this.native.apply(c);
 if(c.port==='GP0'){
 if(c.op===2)this.syncRect(w[1]&1008,w[1]>>>16&511,((w[2]&1023)+15)&~15,w[2]>>>16&511);
 else if(c.op>=0x80&&c.op<0xc0){const upload=c.op>=0xa0,dst=w[upload?1:2],[ww,hh]=dim(w[upload?2:3]);this.syncRect(dst&1023,dst>>>16&511,ww,hh);}
 else if(c.kind==='line'){const xs=c.v.map(v=>v.xy[0]+this.native.state.offset[0]),ys=c.v.map(v=>v.xy[1]+this.native.state.offset[1]);const x=Math.max(0,Math.min(...xs)),y=Math.max(0,Math.min(...ys));this.syncRect(x,y,Math.max(0,Math.min(1023,Math.max(...xs))-x+1),Math.max(0,Math.min(511,Math.max(...ys))-y+1));}}
 }
 seek(n){let p=this.points[0];for(const q of this.points)if(q.at<=n&&q.at>p.at)p=q;if(this.at>n||this.at<p.at)this.restore(p);while(this.at<n){this.apply(this.dump.commands[this.at++]);if(this.at%this.stride===0&&!this.points.some(p=>p.at===this.at))this.points.push(this.snapshot());}}
 crop(target){const st=this.native.state,s=this.scale,reg=target==='display'?[...st.display,...st.resolution]:[st.area[0],st.area[1],Math.max(1,st.area[2]-st.area[0]+1),Math.max(1,st.area[3]-st.area[1]+1)];const [x,y,w,h]=reg,width=w*s,height=h*s,pixels=new Uint8ClampedArray(width*height*4);for(let j=0;j<height;j++)for(let i=0;i<width;i++){const v=this.render.vram[((y*s+j)%(H*s))*(W*s)+((x*s+i)%(W*s))],k=(j*width+i)*4;pixels[k]=(v&31)*255/31;pixels[k+1]=(v>>5&31)*255/31;pixels[k+2]=(v>>10&31)*255/31;pixels[k+3]=255;}return {pixels,width,height};}
}
function texturePreview(raw,c){
 if(!raw||!c?.clut||!c.page||!c.v?.length)return null;
 const g=new GPU();g.vram=raw;g.state.window=c.textureWindow||[0,0,0,0];
 let uv=c.v.map(v=>v.uv).filter(Boolean);
 if(c.kind==='rectangle'){const [u,v]=uv[0],[w,h]=c.size||[1,1],fx=c.textureFlip?.[0]?-1:1,fy=c.textureFlip?.[1]?-1:1;uv=[[u,v],[u+Math.max(0,w-1)*fx,v],[u,v+Math.max(0,h-1)*fy],[u+Math.max(0,w-1)*fx,v+Math.max(0,h-1)*fy]];}
 const left=Math.min(...uv.map(v=>v[0])),top=Math.min(...uv.map(v=>v[1]));
 const width=Math.min(256,Math.max(...uv.map(v=>v[0]))-left+1),height=Math.min(256,Math.max(...uv.map(v=>v[1]))-top+1);
 function decode(x,y,w,h){const out=new Uint8ClampedArray(w*h*4);for(let j=0;j<h;j++)for(let i=0;i<w;i++){const value=g.tex(x+i,y+j,c.page,c.clut),at=(j*w+i)*4;out[at]=(value&31)*255/31;out[at+1]=(value>>5&31)*255/31;out[at+2]=(value>>10&31)*255/31;out[at+3]=value===0?0:255;}return out;}
 return {page:decode(0,0,256,256),crop:decode(left,top,width,height),width,height,left,top,uv,windowed:g.state.window.some(Boolean)};
}
root.PSX={parse,GPU,EnhancedReplay,hex,clone,texturePreview};if(typeof module!=='undefined')module.exports=root.PSX;
})(typeof self!=='undefined'?self:globalThis);
