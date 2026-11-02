import test from 'node:test';
import assert from 'node:assert/strict';
import {isSupportedRaster} from '../public/image-format.js';
const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
test('accepts raster signatures with matching metadata and allows empty MIME',()=>{
  assert.equal(isSupportedRaster({name:'photo.PNG',type:'image/png'},png),true);
  assert.equal(isSupportedRaster({name:'photo.png',type:''},png),true);
  assert.equal(isSupportedRaster({name:'photo.jpg',type:'image/jpeg'},new Uint8Array([255,216,255,224])),true);
  assert.equal(isSupportedRaster({name:'photo.webp',type:'image/webp'},new Uint8Array([82,73,70,70,0,0,0,0,87,69,66,80])),true);
});
test('rejects SVG disguised as a raster and metadata/content mismatches',()=>{
  const svg=new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">');
  for(const type of ['','image/jpeg','image/svg+xml'])assert.equal(isSupportedRaster({name:'photo.jpg',type},svg),false);
  assert.equal(isSupportedRaster({name:'photo.jpg',type:'image/jpeg'},png),false);
  assert.equal(isSupportedRaster({name:'photo.png',type:'image/svg+xml'},png),false);
  assert.equal(isSupportedRaster({name:'photo.svg',type:'image/png'},png),false);
  assert.equal(isSupportedRaster({name:'photo.png',type:'image/png'},new Uint8Array()),false);
});
