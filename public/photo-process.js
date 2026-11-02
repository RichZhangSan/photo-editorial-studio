// Pixel-derived shapes: no generated geometry or subject coordinates.
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const linear = Array.from({ length: 256 }, (_, i) => i / 255 <= .04045 ? i / 3294.6 : ((i / 255 + .055) / 1.055) ** 2.4);
export function lab(rgb) {
  const [r, g, b] = rgb.map(v => linear[clamp(Math.round(v), 0, 255)]);
  const l = Math.cbrt(.4122214708*r + .5363325363*g + .0514459929*b);
  const m = Math.cbrt(.2119034982*r + .6806995451*g + .1073969566*b);
  const s = Math.cbrt(.0883024619*r + .2817188376*g + .6299787005*b);
  return [(.2104542553*l + .793617785*m - .0040720468*s)*100, (1.9779984951*l - 2.428592205*m + .4505937099*s)*100, (.0259040371*l + .7827717662*m - .808675766*s)*100];
}
const distance = (a,b) => (a[0]-b[0])**2 + 3*(a[1]-b[1])**2 + 3*(a[2]-b[2])**2;

// Separable bilateral passes smooth similar colours without averaging across strong edges.
export function smoothPixels(data, width, height, strength = 35) {
  if (!strength) return new Uint8ClampedArray(data);
  let src = new Uint8ClampedArray(data), dst = new Uint8ClampedArray(data.length);
  const radius = 2 + Math.round(strength / 25);
  const sigma = 8 + strength * .28;
  const range = Float32Array.from({length: 195076}, (_, d) => Math.exp(-d/(2*sigma*sigma)));
  const spatial = Array.from({length: radius*2+1}, (_, i) => Math.exp(-((i-radius)**2)/(radius*radius)));
  for (let pass = 0; pass < 4; pass++) {
    const horizontal = pass % 2 === 0;
    for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
      const p = (y*width+x)*4;
      let r=0,g=0,b=0,total=0;
      for (let offset=-radius; offset<=radius; offset++) {
        const xx = horizontal ? clamp(x+offset,0,width-1) : x;
        const yy = horizontal ? y : clamp(y+offset,0,height-1);
        const q = (yy*width+xx)*4;
        const d = (src[p]-src[q])**2+(src[p+1]-src[q+1])**2+(src[p+2]-src[q+2])**2;
        const w = range[d]*spatial[offset+radius];
        r+=src[q]*w; g+=src[q+1]*w; b+=src[q+2]*w; total+=w;
      }
      dst[p]=r/total; dst[p+1]=g/total; dst[p+2]=b/total; dst[p+3]=255;
    }
    [src,dst]=[dst,src];
  }
  return src;
}
const bin = (r,g,b) => (r>>3)*1024+(g>>3)*32+(b>>3);
export function quantize(data, count=8, suggested=[]) {
  const bins = new Map();
  for(let i=0;i<data.length;i+=4) {
    const key=bin(data[i],data[i+1],data[i+2]);
    let v=bins.get(key);
    if(!v) { v={key,n:0,rgb:[0,0,0]}; bins.set(key,v); }
    v.n++; for(let c=0;c<3;c++) v.rgb[c]+=data[i+c];
  }
  const samples=[...bins.values()].map(v=>({...v,rgb:v.rgb.map(c=>c/v.n)}));
  if(!samples.length) throw new Error('没有可处理的像素');
  for(const v of samples) v.lab=lab(v.rgb);
  // Sublinear weighting keeps small, distinctive subject colours represented.
  const centers=[samples.reduce((a,b)=>a.n>b.n?a:b).lab.slice()];
  for(let k=1;k<Math.min(count,samples.length);k++) {
    let best=null, score=-1;
    for(const v of samples) {
      const d=Math.min(...centers.map(c=>distance(v.lab,c)))*Math.pow(v.n,.25);
      if(d>score) {best=v;score=d;}
    }
    centers.push(best.lab.slice());
  }
  const labels=new Uint8Array(samples.length);
  for(let iteration=0;iteration<12;iteration++) {
    const sums=centers.map(()=>[0,0,0,0]);
    samples.forEach((v,i)=>{
      let best=0, d=Infinity;
      centers.forEach((c,k)=>{const dd=distance(v.lab,c);if(dd<d){d=dd;best=k;}});
      labels[i]=best;
      const w=Math.sqrt(v.n), s=sums[best];
      for(let c=0;c<3;c++) s[c]+=v.lab[c]*w;
      s[3]+=w;
    });
    sums.forEach((s,k)=>{if(s[3]) centers[k]=s.slice(0,3).map(v=>v/s[3]);});
  }
  const sums=centers.map(()=>[0,0,0,0]);
  samples.forEach((v,i)=>{const s=sums[labels[i]];for(let c=0;c<3;c++)s[c]+=v.rgb[c]*v.n;s[3]+=v.n;});
  const palette=sums.map(s=>s[3]?s.slice(0,3).map(c=>Math.round(c/s[3])):[0,0,0]);
  const candidates=suggested.filter(c=>/^#[0-9a-f]{6}$/i.test(c)).map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16))).map(rgb=>({rgb,lab:lab(rgb)}));
  const styled=palette.map(rgb=>{
    const origin=lab(rgb), chroma=Math.hypot(origin[1],origin[2]);
    const options=candidates.filter(c=>Math.abs(c.lab[0]-origin[0])<12 && (chroma<5 ? Math.hypot(c.lab[1],c.lab[2])<6 : c.lab[1]*origin[1]+c.lab[2]*origin[2]>0));
    options.sort((a,b)=>distance(a.lab,origin)-distance(b.lab,origin));
    if(!options.length || distance(options[0].lab,origin)>220) return rgb;
    return rgb.map((c,i)=>Math.round(c*.65+options[0].rgb[i]*.35));
  });
  const lookup=new Uint8Array(32768);
  samples.forEach((v,i)=>{lookup[v.key]=labels[i];});
  const output=new Uint8ClampedArray(data.length), base=new Uint8ClampedArray(data.length);
  for(let i=0;i<data.length;i+=4) {
    const k=lookup[bin(data[i],data[i+1],data[i+2])];
    for(let c=0;c<3;c++){output[i+c]=styled[k][c];base[i+c]=palette[k][c];}
    output[i+3]=base[i+3]=255;
  }
  return {data:output,base,palette:styled};
}
export function posterLayout(w,h) {
  const scale=Math.min(840/w,1000/h);
  const width=w*scale,height=h*scale;
  return {x:80,y:80,width,height,canvasWidth:Math.max(320,Math.ceil(width+160)),canvasHeight:Math.ceil(height+260)};
}
