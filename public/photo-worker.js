import { smoothPixels, quantize } from './photo-process.js';
let source, width, height, smooth, lastStrength;
self.onmessage = ({data: request}) => {
  const {id, pixels, options} = request;
  try {
    if(pixels) {
      source = new Uint8ClampedArray(pixels.data);
      width = pixels.width; height = pixels.height;
      smooth = null;
    }
    if(!source) throw new Error('请先选择照片');
    self.postMessage({id,progress:'正在保留轮廓、平滑细碎纹理…'});
    if(!smooth || lastStrength!==options.strength) {
      smooth = smoothPixels(source,width,height,options.strength);
      lastStrength = options.strength;
    }
    self.postMessage({id,progress:'正在归并专色，保留明暗关系…'});
    const result=quantize(smooth,options.colors,options.suggested);
    self.postMessage({id,width,height,...result},[result.data.buffer,result.base.buffer]);
  } catch {
    self.postMessage({id,error:'照片处理失败，请缩小图片后重试。'});
  }
};
