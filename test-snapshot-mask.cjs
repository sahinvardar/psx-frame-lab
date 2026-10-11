const assert=require('node:assert/strict'),P=require('./dist/engine.js');
const gpu=new P.GPU();gpu.state.maskSet=true;gpu.state.maskCheck=true;gpu.vram[0]=0xffff;
const snapshot={port:'GP0',op:0xa0,kind:'transfer',setup:true,w:Uint32Array.of(0xa0000000,0,4|(1<<16),0x43213210,0xfedcba98)};
gpu.apply(snapshot);assert.deepEqual(Array.from(gpu.vram.slice(0,4)),[0x3210,0x4321,0xba98,0xfedc]);assert(gpu.state.maskSet&&gpu.state.maskCheck);
for(let i=0;i<16;i++)gpu.vram[480*1024+i]=i;
const page={x:0,y:0,depth:0},clut=[0,480];assert.deepEqual(Array.from({length:16},(_,u)=>gpu.tex(u,0,page,clut)),[0,1,2,3,1,2,3,4,8,9,10,11,12,13,14,15]);
// Reproduce the former artifact: an all-zero snapshot became 0x8000 words,
// so every fourth texel used palette entry 8 instead of transparent entry 0.
const blank={...snapshot,w:Uint32Array.of(0xa0000000,16,4|(1<<16),0,0)};gpu.apply(blank);assert.deepEqual(Array.from(gpu.vram.slice(16,20)),[0,0,0,0]);
// Recorded uploads must still obey hardware mask settings.
gpu.state.maskCheck=false;gpu.apply({...blank,setup:false});assert.deepEqual(Array.from(gpu.vram.slice(16,20)),[0x8000,0x8000,0x8000,0x8000]);gpu.state.maskCheck=true;gpu.apply({...snapshot,setup:false});assert.equal(gpu.vram[2],0xba98);
console.log('Passed: byte-exact snapshot restore, all four packed indices, transparent background without fourth-pixel stripes, preserved mask state and recorded upload semantics.');
