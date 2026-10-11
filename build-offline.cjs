const fs=require('node:fs'),path=require('node:path');
const dir=path.join(__dirname,'dist'),read=f=>fs.readFileSync(path.join(dir,f),'utf8');
const safe=s=>s.replace(/<\/script/gi,'<\\/script');
const worker=read('vendor/fzstd.js')+'\n;\n'+read('engine.js')+'\n;\n'+read('worker.js').replace("importScripts('vendor/fzstd.js','engine.js');",'');
let html=read('index.html').replace('<link rel="stylesheet" href="style.css">','<style>'+read('style.css')+'</style>');
html=html.replace('<script src="engine.js"></script><script src="app.js"></script>', '<script>'+safe(read('engine.js'))+'</script><script>window.PSX_WORKER_SOURCE='+JSON.stringify(worker).replace(/</g,'\\u003c')+';</script><script>'+safe(read('app.js'))+'</script>');
html=html.replace('<head>','<head><!-- Third-party component: fzstd 0.1.1\n'+read('vendor/fzstd-LICENSE.txt')+'\n-->');
fs.writeFileSync(path.join(dir,'PSX-Frame-Lab.html'),html);
console.log('Built standalone HTML, '+Buffer.byteLength(html)+' bytes.');
