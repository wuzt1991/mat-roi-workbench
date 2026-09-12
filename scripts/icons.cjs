const {mkdirSync,readFileSync,writeFileSync}=require('node:fs');
const path=require('node:path'),{execFileSync}=require('node:child_process');
const dir=path.join(__dirname,'..','build'),set=path.join(dir,'app.iconset');
mkdirSync(set,{recursive:true});
const png=path.join(dir,'app.png');
const mark=readFileSync(path.join(__dirname,'..','public','assets','brand-mark.svg'),'utf8').replace(/<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'');
const desktop=`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none"><defs><linearGradient id="tile" x1="120" y1="80" x2="800" y2="950" gradientUnits="userSpaceOnUse"><stop stop-color="#FDFEFF"/><stop offset="1" stop-color="#EAF0F5"/></linearGradient></defs><rect x="66" y="68" width="892" height="892" rx="204" fill="#C8D5DF" fill-opacity=".38"/><rect x="66" y="60" width="892" height="892" rx="204" fill="url(#tile)" stroke="#FFFFFF" stroke-width="3"/><g transform="translate(130 128) scale(3)">${mark}</g></svg>`;
const source=path.join(dir,'app.svg');writeFileSync(source,desktop);
execFileSync('swift',[path.join(__dirname,'icon.swift'),source,png],{stdio:'inherit'});
for(const size of [16,32,128,256,512])for(const scale of [1,2]){
  execFileSync('sips',['-z',String(size*scale),String(size*scale),png,'--out',path.join(set,`icon_${size}x${size}${scale===2?'@2x':''}.png`)],{stdio:'ignore'});
}
execFileSync('iconutil',['-c','icns',set,'-o',path.join(dir,'app.icns')]);
const sizes=[16,24,32,48,64,128,256],frames=sizes.map(size=>{const filename=path.join(dir,`win-${size}.png`);execFileSync('swift',[path.join(__dirname,'icon.swift'),source,filename,String(size)],{stdio:'inherit'});return readFileSync(filename);}),header=Buffer.alloc(6+16*sizes.length);
header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
frames.forEach((bytes,i)=>{const entry=6+16*i;header[entry]=sizes[i]%256;header[entry+1]=sizes[i]%256;header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(bytes.length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=bytes.length;});
writeFileSync(path.join(dir,'app.ico'),Buffer.concat([header,...frames]));
execFileSync('sips',['-z','256','256',png,'--out',path.join(__dirname,'..','public','assets','app-icon.png')],{stdio:'ignore'});
console.log('已生成 macOS 和 Windows 应用图标');
