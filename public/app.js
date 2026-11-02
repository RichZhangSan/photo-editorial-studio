import { posterLayout } from './photo-process.js';
import { cleanMotif, drawEditorial } from './photo-editorial.js';
import { isSupportedRaster } from './image-format.js';
const $=selector=>document.querySelector(selector);
const state={sourceImage:null,sourceDataUrl:'',pixels:null,cached:null,raster:null,rasterKey:'',busy:false,loading:false,health:null,plan:null,motif:null,resultMode:null};
const canvas=$('#resultCanvas'),fileInput=$('#fileInput'),generateButton=$('#generateButton'),aiButton=$('#aiButton'),downloadButton=$('#downloadButton'),resultMeta=$('#resultMeta');
let worker,requestId=0,renderTimer;const pending=new Map();
const mode=()=>$('#mode').value;
function status(text,kind=''){$('#apiStatus').textContent=text;$('#apiStatus').className=`status-pill ${kind}`;}
function controls(){
  const locked=state.busy||state.loading,editorial=mode()==='editorial';
  const ready=!!state.sourceImage,available=state.health?.configured&&state.health?.editorial?.configured;
  generateButton.disabled=locked||!ready||(editorial&&!state.motif&&!available);
  generateButton.textContent=state.busy?'正在处理…':editorial?(state.motif?'更新排版（本地处理）':state.plan?'继续生成抽象图形':'AI 生成摄影＋抽象'):(state.raster?'重新绘制（本地处理）':'生成保形海报');
  aiButton.disabled=locked||!ready||!state.health?.configured||!!state.cached;
  aiButton.textContent=state.cached?'AI 建议已缓存':'AI 配色与文案';aiButton.classList.toggle('hidden',editorial);
  $('#retryMotifButton').classList.toggle('hidden',!editorial||!state.motif);$('#retryMotifButton').disabled=locked||!available;
  for(const id of ['fileInput','clearButton','mode','paper','texture','seed','colors','strength','colorMode','layout','panelSize','motifScale','editorialTitle','editorialSubtitle'])$('#'+id).disabled=locked;
  downloadButton.disabled=locked||state.resultMode!==mode();
  $('#editorialControls').classList.toggle('hidden',!editorial);$('#posterControls').classList.toggle('hidden',editorial);
  $('#connectionInfo').textContent=editorial?(available?'视觉分析与图像生成已连接。生成可能需要 1–3 分钟。':'编辑模式需要本机视觉模型与 MiniMax Code 图片生成连接；可先使用保形专色模式。'):(state.health?.configured?`可选 AI：${state.health.provider} · ${state.health.model}，仅建议配色与文案。`:'AI 暂不可用，保形专色仍可本地生成。');
  $('#privacyInfo').textContent=editorial?'AI 生成会将压缩照片发送至视觉模型及图片生成服务，并通过临时图片链接供生成服务读取；可能计入账户用量。版式、底色与文字调整均在本地完成，不重复调用 AI。结果仅在当前页面缓存。':'保形处理在浏览器内完成；仅点击 AI 配色与文案时发送压缩图。参数调整不调用模型，更换照片或刷新清除缓存。';
}
async function checkHealth(){try{const r=await fetch('/api/health',{signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error();state.health=await r.json();}catch{state.health=null;}if(!state.sourceImage&&!state.loading)status('请选择一张照片','ready');controls();}
function imageFrom(url){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('图片无法解码，请转为 JPG、PNG 或 WebP。'));image.src=url;});}
function resetResult(){canvas.classList.add('hidden');$('#emptyState').classList.remove('hidden');$('#comparison').classList.add('hidden');$('#sceneDetails').classList.add('hidden');state.resultMode=null;downloadButton.disabled=true;}
function stopWorker(){worker?.terminate();worker=null;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('照片已更换'));}pending.clear();}
function clearCache(){state.sourceImage=null;state.sourceDataUrl='';state.pixels=null;state.cached=null;state.raster=null;state.rasterKey='';state.plan=null;state.motif=null;$('#editorialTitle').value='';$('#editorialSubtitle').value='';$('#progressSteps').classList.add('hidden');resetResult();}
async function loadFile(file){
  if(state.busy||state.loading)return;
  if(!/\.(jpe?g|png|webp)$/i.test(file.name)&&!['image/jpeg','image/png','image/webp'].includes(file.type)){status('请选择 JPG、PNG 或 WebP','error');return;}
  if(file.size>30*1024*1024){status('图片超过 30 MB，请先压缩','error');return;}
  clearTimeout(renderTimer);stopWorker();clearCache();state.loading=true;$('#previewWrap').classList.add('hidden');status('正在读取图片…');controls();
  let url;
  try{
    const header=new Uint8Array(await file.slice(0,12).arrayBuffer());
    if(!isSupportedRaster(file,header))throw new Error('文件内容与图片格式不符，请选择真实的 JPG、PNG 或 WebP 文件。');
    url=URL.createObjectURL(file);
    const image=await imageFrom(url);if(image.width*image.height>80000000)throw new Error('图片像素过大，请缩小后再上传。');
    const scale=Math.min(1,1500/Math.max(image.width,image.height)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(image.width*scale));c.height=Math.max(1,Math.round(image.height*scale));
    const ctx=c.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(image,0,0,c.width,c.height);
    state.sourceDataUrl=c.toDataURL('image/jpeg',.92);
    // Keep the decoded original for final composition; JPEG is only the AI input/preview.
    state.sourceImage=image;$('#previewImage').src=state.sourceDataUrl;$('#originalCompare').src=state.sourceDataUrl;$('#previewWrap').classList.remove('hidden');$('#fileLabel').textContent=file.name;$('#colorMode').value='source';
    const s=Math.min(1,1000/Math.max(c.width,c.height)),pixels=document.createElement('canvas');pixels.width=Math.max(1,Math.round(c.width*s));pixels.height=Math.max(1,Math.round(c.height*s));
    const pc=pixels.getContext('2d',{willReadFrequently:true});pc.drawImage(c,0,0,pixels.width,pixels.height);state.pixels=pc.getImageData(0,0,pixels.width,pixels.height);
    status('照片已就绪','ready');resultMeta.textContent=`${image.width} × ${image.height} · 仅本地读取，尚未发送给 AI${Math.min(image.width,image.height)<500?' · 当前照片分辨率偏低，输出无法补回细节':''}`;
  }catch(error){clearCache();status('读取图片失败','error');resultMeta.textContent=error.message;}
  finally{if(url)URL.revokeObjectURL(url);state.loading=false;controls();}
}
function clearFile(){if(state.busy||state.loading)return;clearTimeout(renderTimer);stopWorker();clearCache();fileInput.value='';$('#previewImage').removeAttribute('src');$('#originalCompare').removeAttribute('src');$('#previewWrap').classList.add('hidden');$('#fileLabel').textContent='选择一张图片';status('请选择一张照片','ready');resultMeta.textContent='尚未生成';controls();}
function settings(){return {colors:Number($('#colors').value),strength:Number($('#strength').value),colorMode:$('#colorMode').value,paper:$('#paper').value,texture:Number($('#texture').value),seed:Number($('#seed').value)||0};}
function processPhoto(options){
  let pixels;if(!worker){worker=new Worker('/photo-worker.js',{type:'module'});pixels={width:state.pixels.width,height:state.pixels.height,data:state.pixels.data.slice()};worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;if(data.progress){status(data.progress);return;}clearTimeout(p.timer);pending.delete(data.id);if(data.error)p.reject(new Error(data.error));else p.resolve(data);};worker.onerror=()=>{stopWorker();status('本地处理线程出错，请重试','error');};}
  return new Promise((resolve,reject)=>{const id=++requestId,timer=setTimeout(()=>{stopWorker();reject(new Error('本地处理超时，请缩小照片后重试。'));},45000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,pixels,options});});
}
function putRaster(target,data,width,height){target.width=width;target.height=height;target.getContext('2d').putImageData(new ImageData(data,width,height),0,0);}
function showResult(){state.resultMode=mode();$('#comparison').classList.remove('hidden');$('#emptyState').classList.add('hidden');canvas.classList.remove('hidden');}
function showFacts(){if(!state.plan||mode()!=='editorial')return;$('#sceneText').textContent=state.plan.scene;$('#sceneFacts').replaceChildren(...state.plan.facts.map(fact=>{const li=document.createElement('li');li.textContent=fact;return li;}));$('#sceneDetails').classList.remove('hidden');}
function composeEditorial(){
  const frame=drawEditorial(canvas,state.sourceImage,state.motif,state.plan,{layout:$('#layout').value,panel:Number($('#panelSize').value),scale:Number($('#motifScale').value),paper:$('#paper').value,title:$('#editorialTitle').value,subtitle:$('#editorialSubtitle').value});
  const detail=$('#detailCanvas');detail.width=state.motif.width;detail.height=state.motif.height;const ctx=detail.getContext('2d');ctx.fillStyle={warm:'#f3f0e8',clean:'#faf9f5',cool:'#e9ece6'}[$('#paper').value];ctx.fillRect(0,0,detail.width,detail.height);ctx.drawImage(state.motif,0,0);
  $('#detailCaption').textContent='AI 抽象图形 · 对照原图检查空间关系';showResult();showFacts();
  resultMeta.textContent=`${frame.width} × ${frame.height} · 照片等比缩放、不重绘 · 图形与标题独立合成 · 调整排版不调用 AI`;status('编辑海报已完成','ready');
}
function progress(step,text){$('#progressSteps').classList.remove('hidden');['stepPlan','stepMotif','stepCompose'].forEach((id,i)=>{$('#'+id).className=i<step?'done':i===step?'active':'';});status(text);}
async function post(url,body,timeout){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});let data;try{data=await response.json();}catch{throw new Error('服务未返回有效结果，请检查本地服务。');}if(!response.ok)throw new Error(data.error||'生成未完成，请重试。');return data;}
async function generateEditorial(force=false){
  if(!state.sourceImage||state.busy||state.loading)return;
  if(state.motif&&!force){composeEditorial();controls();return;}
  state.busy=true;controls();let timer,phase='观察照片';
  const start=Date.now();timer=setInterval(()=>{resultMeta.textContent=`${phase} · 已等待 ${Math.floor((Date.now()-start)/1000)} 秒 · 请保持页面打开`;},1000);
  try{
    if(!state.plan){progress(0,'正在观察照片中的关系…');const plan=await post('/api/editorial/plan',{image:state.sourceDataUrl},165000);if(plan.mode!=='photo-editorial'||!Array.isArray(plan.facts)||!Array.isArray(plan.palette))throw new Error('场景分析格式无效，请重试。');state.plan=plan;$('#editorialTitle').value=plan.title;$('#editorialSubtitle').value=plan.subtitle||'';showFacts();}
    phase='绘制抽象图形';progress(1,'正在绘制抽象图形…');const payload=await post('/api/editorial/motif',{image:state.sourceDataUrl,plan:state.plan},630000);
    if(!/^data:image\/(png|jpeg|webp);base64,/.test(payload.dataUrl||''))throw new Error('图片服务未返回可用图形。');
    phase='清理背景并排版';progress(2,'正在清理图形背景并排版…');const image=await imageFrom(payload.dataUrl);
    if(image.width*image.height>16000000)throw new Error('抽象图形尺寸过大，请重试。');
    const raw=document.createElement('canvas');raw.width=image.width;raw.height=image.height;const rc=raw.getContext('2d',{willReadFrequently:true});rc.drawImage(image,0,0);
    const cleaned=cleanMotif(rc.getImageData(0,0,raw.width,raw.height).data,raw.width,raw.height);putRaster(raw,cleaned.data,cleaned.width,cleaned.height);
    const motif=document.createElement('canvas'),b=cleaned.bounds;motif.width=b.width;motif.height=b.height;motif.getContext('2d').drawImage(raw,b.x,b.y,b.width,b.height,0,0,b.width,b.height);
    state.motif=motif;clearInterval(timer);composeEditorial();progress(3,'编辑海报已完成');
  }catch(error){clearInterval(timer);status(state.motif?'生成未完成，保留上一张海报':'AI 生成未完成','error');resultMeta.textContent=error.name==='TimeoutError'?'生成等待超时，请稍后重试；已完成的场景分析仍保留。':error.message;$('#progressSteps .active')?.classList.add('failed');}
  finally{clearInterval(timer);state.busy=false;controls();}
}
async function renderPoster(){const s=settings(),suggested=s.colorMode==='guided'?(state.cached?.colors||[]):[],key=JSON.stringify([s.colors,s.strength,suggested]);if(!state.raster||state.rasterKey!==key){state.raster=await processPhoto({...s,suggested});state.rasterKey=key;}composePoster();resultMeta.textContent=`${state.cached?.scene||'轮廓来自原照片'} · ${state.raster.palette.length} 色 · ${canvas.width} × ${canvas.height} · 参数调整不调用模型${s.colorMode==='guided'&&!state.cached?' · 暂用原图配色':''}`;status('海报生成完成','ready');}
async function generate(){if(mode()==='editorial')return generateEditorial();if(!state.sourceImage||state.busy||state.loading)return;state.busy=true;controls();try{await renderPoster();}catch(error){status('生成失败','error');resultMeta.textContent=error.message;}finally{state.busy=false;controls();}}
async function enrich(){if(!state.sourceImage||state.busy||state.cached)return;state.busy=true;controls();let timer;try{await renderPoster();status('AI 正在建议配色与文案…');const start=Date.now();timer=setInterval(()=>{resultMeta.textContent=`本地海报已生成 · 等待 AI 建议 ${Math.floor((Date.now()-start)/1000)} 秒`;},1000);const payload=await post('/api/collage',{image:state.sourceDataUrl},165000);if(payload.mode!=='photo-poster'||!Array.isArray(payload.colors))throw new Error('AI 配色格式无效。');state.cached=payload;$('#colorMode').value='guided';clearInterval(timer);await renderPoster();}catch(error){status('保留本地海报，AI 建议未完成','error');resultMeta.textContent=error.name==='TimeoutError'?'AI 请求超时，本地海报仍可下载。':error.message;}finally{clearInterval(timer);state.busy=false;controls();}}
function fittedText(ctx,text,maxWidth,start,min=10){let size=start;do{ctx.font=`${size}px Georgia, "Songti SC", serif`;if(ctx.measureText(text).width<=maxWidth)break;size--;}while(size>min);return size;}
function composePoster(){
  const s=settings(),r=state.raster,frame=posterLayout(state.sourceImage.width,state.sourceImage.height);frame.x=(frame.canvasWidth-frame.width)/2;canvas.width=frame.canvasWidth;canvas.height=frame.canvasHeight;const ctx=canvas.getContext('2d');ctx.fillStyle=s.paper==='warm'?'#f0e9d9':s.paper==='cool'?'#e5e7e1':'#faf8f1';ctx.fillRect(0,0,canvas.width,canvas.height);
  const art=document.createElement('canvas');putRaster(art,r.data,r.width,r.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(art,frame.x,frame.y,frame.width,frame.height);drawTexture(ctx,frame,s.texture,s.seed);
  ctx.fillStyle='#30342e';ctx.textAlign='center';ctx.textBaseline='alphabetic';const title=state.cached?.title||'An ordinary, beautiful day.';fittedText(ctx,title,canvas.width-80,27,9);ctx.fillText(title,canvas.width/2,frame.y+frame.height+66,canvas.width-80);const subtitle=state.cached?.subtitle||'A MOMENT, KEPT IN COLOUR';ctx.font='11px Arial, sans-serif';ctx.globalAlpha=.65;ctx.fillText(subtitle,canvas.width/2,frame.y+frame.height+92,canvas.width-80);ctx.globalAlpha=1;
  putRaster($('#detailCanvas'),r.base,r.width,r.height);$('#detailCaption').textContent='保形专色 · 检查轮廓与细节';$('#sceneDetails').classList.add('hidden');showResult();
}
function drawTexture(ctx,frame,amount,seed){if(!amount)return;let t=seed;const random=()=>{t+=0x6D2B79F5;let n=Math.imul(t^t>>>15,t|1);n^=n+Math.imul(n^n>>>7,n|61);return((n^n>>>14)>>>0)/4294967296;};ctx.save();ctx.beginPath();ctx.rect(frame.x,frame.y,frame.width,frame.height);ctx.clip();ctx.globalAlpha=amount/100*.12;for(let i=0;i<frame.width*frame.height/20;i++){ctx.fillStyle=i%2?'#fffaf0':'#30342e';ctx.fillRect(frame.x+random()*frame.width,frame.y+random()*frame.height,.5+random(),.5+random());}ctx.restore();}
function rerender(){clearTimeout(renderTimer);renderTimer=setTimeout(()=>{if(state.busy||state.loading)return;if(mode()==='editorial'){if(state.motif){composeEditorial();controls();}}else if(state.raster)generate();},180);}
function changeMode(){clearTimeout(renderTimer);resetResult();$('#progressSteps').classList.add('hidden');const editorial=mode()==='editorial';$('#resultHeading').textContent=editorial?'真实的片刻，抽象的回声。':'照片里的形状，纸上的颜色。';$('#emptyDescription').textContent=editorial?'保留原片，提炼少数重要关系。用有限的形状和颜色，为日常留一点空白。':'从 12 色开始，保留照片轮廓和比例。保形处理无需调用 AI。';resultMeta.textContent='尚未生成';if(editorial&&state.motif)composeEditorial();else if(!editorial&&state.raster){composePoster();resultMeta.textContent='已恢复缓存的保形海报 · 调整参数不调用模型';}status(state.sourceImage?'照片已就绪':'请选择一张照片','ready');controls();}
async function downloadResult(){if(state.resultMode!==mode()||state.busy)return;try{const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error();const decoded=await createImageBitmap(blob),valid=decoded.width===canvas.width&&decoded.height===canvas.height;decoded.close();if(!valid)throw new Error();const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`photo-${mode()}-${Date.now()}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);status('PNG 已校验，已发起下载','ready');resultMeta.textContent=`PNG 编码及解码校验通过 · ${canvas.width} × ${canvas.height} · ${(blob.size/1024).toFixed(0)} KB`;}catch{status('PNG 导出失败，请重试','error');}}
for(const [id,suffix] of [['texture','%'],['strength','%'],['panelSize',''],['motifScale','']])$('#'+id).addEventListener('input',()=>{$('#'+id+'Value').textContent=$('#'+id).value+suffix;rerender();});
for(const id of ['paper','colors','colorMode','layout'])$('#'+id).addEventListener('change',rerender);
for(const id of ['seed','editorialTitle','editorialSubtitle'])$('#'+id).addEventListener('input',rerender);
$('#mode').addEventListener('change',changeMode);fileInput.addEventListener('click',()=>{fileInput.value='';});fileInput.addEventListener('change',()=>{if(fileInput.files[0])loadFile(fileInput.files[0]);});
$('#clearButton').addEventListener('click',clearFile);generateButton.addEventListener('click',generate);aiButton.addEventListener('click',enrich);downloadButton.addEventListener('click',downloadResult);$('#retryMotifButton').addEventListener('click',()=>generateEditorial(true));
for(const name of ['dragenter','dragover'])$('#dropzone').addEventListener(name,event=>{event.preventDefault();if(!state.busy)$('#dropzone').classList.add('dragging');});
for(const name of ['dragleave','drop'])$('#dropzone').addEventListener(name,event=>{event.preventDefault();$('#dropzone').classList.remove('dragging');});$('#dropzone').addEventListener('drop',event=>{if(event.dataTransfer.files[0])loadFile(event.dataTransfer.files[0]);});
checkHealth();
