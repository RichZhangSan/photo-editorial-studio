import test from 'node:test';
import assert from 'node:assert/strict';
import {smoothPixels,quantize,posterLayout} from '../public/photo-process.js';
function fixture(w,h,paint){const a=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)a.set([...paint(x,y),255],(y*w+x)*4);return a;}
function pixel(a,w,x,y){return [...a.slice((y*w+x)*4,(y*w+x)*4+3)];}
test('thin dark limbs and a bright shirt survive smoothing and quantization',()=>{
  const w=80,h=120;
  const source=fixture(w,h,(x,y)=>x>=38&&x<=40&&y>50?[20,20,20]:x>30&&x<50&&y>20&&y<=50?[242,240,234]:[125,140,115]);
  const out=quantize(smoothPixels(source,w,h,70),6).data;
  assert.ok(pixel(out,w,39,80).every(c=>c<40));
  assert.ok(pixel(out,w,35,30).every(c=>c>220));
  assert.ok(pixel(out,w,42,80)[0]>100);
});
test('bilateral processing reduces low contrast noise and preserves a hard edge',()=>{
  const w=60,h=60,source=fixture(w,h,(x,y)=>x<30?Array(3).fill(100+(x%2?5:-5)+(y%2?3:-3)):[240,240,240]);
  const result=smoothPixels(source,w,h,60);
  assert.ok(Math.abs(result[(20*w+20)*4]-100)<4);
  assert.ok(result[(20*w+29)*4]<115);
  assert.ok(result[(20*w+30)*4]>230);
});
test('model suggestions cannot tint neutral whites or blacks green',()=>{
  const data=fixture(30,20,x=>x<10?[240,240,240]:x<20?[25,25,25]:[200,70,40]);
  const result=quantize(data,6,['#c0eac0','#124a18','#d05030']);
  const white=pixel(result.data,30,2,2),black=pixel(result.data,30,12,2);
  assert.equal(white[0],white[1]);assert.equal(black[0],black[1]);
  assert.ok(pixel(result.data,30,22,2)[0]>150);
});
test('colour count is bounded and processing is deterministic',()=>{
  const source=fixture(50,50,(x,y)=>[x*5,y*5,(x+y)*2]);
  const a=quantize(source,8),b=quantize(source,8);
  assert.deepEqual(a.data,b.data);
  const colors=new Set();for(let i=0;i<a.data.length;i+=4)colors.add(a.data.slice(i,i+3).join(','));
  assert.ok(colors.size<=8);
});
test('portrait and landscape frames keep source ratio and leave typography space',()=>{
  for(const [w,h] of [[600,1000],[1600,900],[300,1600],[2000,20]]){
    const f=posterLayout(w,h);
    assert.ok(Math.abs(f.width/f.height-w/h)<Math.max(.01,(w/h)*.03));
    assert.ok(f.canvasHeight-f.y-f.height>=160);
    assert.ok(f.width+f.x<=f.canvasWidth);
  }
});
