import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanMotif, editorialLayout, drawEditorial} from '../public/photo-editorial.js';

function pixels(w,h){return new Uint8ClampedArray(w*h*4).fill(255);}
function paint(p,w,x,y,color){p.set(color,(y*w+x)*4);}
test('edge-connected white cleanup preserves enclosed white marks and source colours',()=>{
  const w=40,h=40,p=pixels(w,h);
  for(let y=10;y<30;y++)for(let x=10;x<30;x++)paint(p,w,x,y,[70,80,60,255]);
  for(let y=17;y<23;y++)for(let x=17;x<23;x++)paint(p,w,x,y,[255,255,255,255]);
  const copy=p.slice(),result=cleanMotif(p,w,h);
  assert.deepEqual(p,copy,'input must not be mutated');
  assert.equal(result.data[3],0);assert.equal(result.data[(20*w+20)*4+3],255);
  assert.deepEqual([...result.data.slice((12*w+12)*4,(12*w+12)*4+4)],[70,80,60,255]);
  assert.deepEqual(result.bounds,{x:10,y:10,width:20,height:20});
});
test('cleanup rejects empty, solid and unbounded generated fields',()=>{
  assert.throws(()=>cleanMotif(pixels(20,20),20,20),/内容不足/);
  const p=pixels(20,20);for(let i=0;i<p.length;i+=4)p.set([40,60,30,255],i);
  assert.throws(()=>cleanMotif(p,20,20),/干净边缘/);
  assert.throws(()=>cleanMotif(new Uint8ClampedArray(5),20,20),/尺寸无效/);
});
test('layout retains photograph aspect ratio and reserves separate motif and type regions',()=>{
  for(const [w,h] of [[2400,1600],[1600,2400],[800,800],[200,4000],[4000,200]])for(const layout of ['wide','vertical','balanced','sparse']){
    const frame=editorialLayout(w,h,{layout,panel:35,scale:115});
    assert.ok(Math.abs(frame.width/frame.photoHeight-w/h)<.01);
    assert.equal(frame.height,frame.photoHeight+frame.panelHeight);
    assert.ok(frame.motifTop>=frame.photoHeight);
    assert.ok(frame.motifTop+frame.motifHeight<frame.titleY);
    assert.ok(frame.titleY<frame.height);
  }
});
test('scale changes both fitted dimensions even for tall motifs in wide layouts',()=>{
  for(const [mw,mh] of [[200,800],[800,200],[600,600]]){
    const rendered=[];
    for(const scale of [65,95]){
      const ctx={fillRect(){},drawImage(image,...args){if(image.width===mw&&image.height===mh)rendered.push(args.slice(2));},measureText(){return {width:10};},fillText(){}};
      drawEditorial({getContext(){return ctx;}},{width:1200,height:1600},{width:mw,height:mh},{title:'Together Outside',subtitle:'',palette:['#343832']},{layout:'wide',scale});
    }
    assert.ok(rendered[1][0]>rendered[0][0]);assert.ok(rendered[1][1]>rendered[0][1]);
    assert.ok(Math.abs(rendered[1][0]/rendered[0][0]-95/65)<1e-9);
  }
});
test('local composer draws original photograph once and confines all editorial marks below it',()=>{
  const calls=[];
  const ctx={fillRect(...a){calls.push(['fill',...a]);},drawImage(...a){calls.push(['image',...a]);},measureText(t){return {width:t.length*10};},fillText(...a){calls.push(['text',...a]);}};
  const canvas={getContext(){return ctx;}},source={width:1200,height:800},motif={width:600,height:220};
  const frame=drawEditorial(canvas,source,motif,{title:'Beside the Path',subtitle:'',layout:'wide',palette:['#46574a','#d47e62']},{layout:'auto',title:'Walking Together',subtitle:''});
  const images=calls.filter(c=>c[0]==='image'),texts=calls.filter(c=>c[0]==='text');
  assert.equal(images.length,2);assert.equal(images[0][1],source);assert.deepEqual(images[0].slice(2),[0,0,frame.width,frame.photoHeight]);
  assert.equal(images[1][1],motif);assert.ok(images[1][3]>=frame.photoHeight);
  assert.equal(texts.length,1);assert.equal(texts[0][1],'Walking Together');assert.ok(texts[0][3]>frame.photoHeight);
});
