// Local composition only. The source photograph never enters the motif renderer.
export function editorialLayout(sourceWidth, sourceHeight, {layout='balanced', panel=60, scale=85}={}) {
  if (![sourceWidth,sourceHeight].every(n=>Number.isFinite(n)&&n>0)) throw new Error('照片尺寸无效');
  let width=Math.min(1600,Math.max(720,sourceWidth));
  let photoHeight=Math.round(sourceHeight*width/sourceWidth);
  if(photoHeight>3200){width=Math.max(1,Math.round(width*3200/photoHeight));photoHeight=3200;}
  const panelHeight=Math.round(Math.max(width*.54,Math.min(width*.95,photoHeight*.62))*Math.max(35,Math.min(90,panel))/60);
  const fraction={wide:.66,vertical:.36,balanced:.48,sparse:.32}[layout]||.48;
  return {width,photoHeight,panelHeight,height:photoHeight+panelHeight,margin:width*.085,
    motifWidth:width*fraction*Math.max(45,Math.min(115,scale))/85,motifHeight:panelHeight*.43*Math.max(45,Math.min(115,scale))/85,
    motifTop:photoHeight+panelHeight*.13,titleY:photoHeight+panelHeight*.80,center:layout==='vertical'||layout==='balanced'};
}

// Remove only near-white pixels connected to the image border. Enclosed white
// source-derived marks survive; no colour-key removal across the whole picture.
export function cleanMotif(data,width,height) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||width*height>16000000||data.length!==width*height*4)throw new Error('抽象图形尺寸无效');
  const pixels=new Uint8ClampedArray(data),total=width*height;
  const visited=new Uint8Array(total),queue=new Int32Array(total);
  let head=0,tail=0;
  const background=i=>{const p=i*4;return pixels[p+3]<16||(Math.min(pixels[p],pixels[p+1],pixels[p+2])>=238&&Math.max(pixels[p],pixels[p+1],pixels[p+2])-Math.min(pixels[p],pixels[p+1],pixels[p+2])<15);};
  const visit=i=>{if(!visited[i]&&background(i)){visited[i]=1;queue[tail++]=i;}};
  let border=0,white=0;
  for(let x=0;x<width;x++){for(const i of [x,(height-1)*width+x]){border++;if(background(i))white++;visit(i);}}
  for(let y=1;y<height-1;y++){for(const i of [y*width,y*width+width-1]){border++;if(background(i))white++;visit(i);}}
  if(white/border<.92)throw new Error('抽象图形未留出干净边缘，请重试图形生成。');
  while(head<tail){const i=queue[head++],x=i%width;pixels[i*4+3]=0;if(x>0)visit(i-1);if(x<width-1)visit(i+1);if(i>=width)visit(i-width);if(i<total-width)visit(i+width);}
  let left=width,top=height,right=-1,bottom=-1,count=0;
  for(let i=0;i<total;i++){
    const p=i*4;if(pixels[p+3]<16)continue;
    const x=i%width,y=Math.floor(i/width);
    // Unmatte the immediate soft boundary against the generator's white field.
    if((x>0&&visited[i-1])||(x<width-1&&visited[i+1])||(y>0&&visited[i-width])||(y<height-1&&visited[i+width])){
      const min=Math.min(pixels[p],pixels[p+1],pixels[p+2]);
      if(min>170){const alpha=Math.max(.08,1-min/255);for(let c=0;c<3;c++)pixels[p+c]=Math.max(0,Math.round((pixels[p+c]-255*(1-alpha))/alpha));pixels[p+3]=Math.round(pixels[p+3]*alpha);}
    }
    if(pixels[p+3]<16)continue;
    count++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  if(count<total*.002||count>total*.82)throw new Error('抽象图形留白或内容不足，请重试图形生成。');
  return {data:pixels,width,height,bounds:{x:left,y:top,width:right-left+1,height:bottom-top+1},coverage:count/total};
}

function fitText(ctx,text,maxWidth,size) {
  let current=size;
  do{ctx.font=`${current}px Georgia, "Songti SC", serif`;if(ctx.measureText(text).width<=maxWidth)break;current-=.5;}while(current>5);
}
export function drawEditorial(canvas,source,motif,plan,options={}) {
  const frame=editorialLayout(source.width,source.height,{...options,layout:options.layout==='auto'?plan.layout:options.layout});
  canvas.width=frame.width;canvas.height=frame.height;
  const ctx=canvas.getContext('2d');
  const paper={warm:'#f3f0e8',clean:'#faf9f5',cool:'#e9ece6'}[options.paper]||'#f3f0e8';
  ctx.fillStyle=paper;ctx.fillRect(0,0,frame.width,frame.height);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(source,0,0,frame.width,frame.photoHeight);
  const factor=Math.min(frame.motifWidth/motif.width,frame.motifHeight/motif.height);
  const mw=motif.width*factor,mh=motif.height*factor;
  ctx.drawImage(motif,(frame.width-mw)/2,frame.motifTop,mw,mh);
  const darkest=[...(plan.palette||['#343832'])].sort((a,b)=>luminance(a)-luminance(b))[0];
  ctx.fillStyle=luminance(darkest)<150?darkest:'#343832';
  ctx.textAlign=frame.center?'center':'left';ctx.textBaseline='alphabetic';
  const x=frame.center?frame.width/2:frame.margin,max=frame.width-frame.margin*2;
  const title=options.title?.trim()||plan.title;
  fitText(ctx,title,max,frame.width*.043);ctx.fillText(title,x,frame.titleY,max);
  const subtitle=options.subtitle===undefined?plan.subtitle:options.subtitle.trim();
  if(subtitle){ctx.globalAlpha=.68;ctx.font=`italic ${frame.width*.017}px Georgia, "Songti SC", serif`;ctx.fillText(subtitle,x,frame.titleY+frame.width*.037,max);ctx.globalAlpha=1;}
  return frame;
}
function luminance(hex){return .2126*parseInt(hex.slice(1,3),16)+.7152*parseInt(hex.slice(3,5),16)+.0722*parseInt(hex.slice(5,7),16);}
