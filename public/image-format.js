// Validate bytes before creating an object URL or letting Image decode the file.
export function isSupportedRaster(file, bytes) {
  const starts=(values,offset=0)=>values.every((value,i)=>bytes[offset+i]===value);
  const mime=starts([137,80,78,71,13,10,26,10])?'image/png':
    starts([255,216,255])?'image/jpeg':
    starts([82,73,70,70])&&starts([87,69,66,80],8)?'image/webp':null;
  if(!mime)return false;
  const extension=(file.name.match(/\.([^.]+)$/)?.[1]||'').toLowerCase();
  const expected={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'}[extension];
  return expected===mime&&(!file.type||file.type.toLowerCase()===mime);
}
