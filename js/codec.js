/*
 * Sketchy drawing codec.
 *
 * Drawings travel from each phone to the big screen as a compact text string
 * instead of an image, so they stay small, scale crisply on a TV, and can be
 * replayed stroke by stroke.
 *
 * Format (see docs/ARCHITECTURE.md for details):
 *   strokes are joined with "."; each stroke is
 *   <style char><x0><y0>(<dx><dy>)*
 *   style char = ALPH[colorIndex * 3 + sizeIndex]
 *   numbers are base-32 varints in a URL-safe alphabet; deltas are zigzag encoded.
 *   Coordinates live on a 0..1000 grid.
 */
(function (root) {
  'use strict';
  const COLORS=['#1D1B3A','#FF3D9A','#2B59D9','#FFC233','#22A86B','#FF7A2F','#8A5A3B','#F4C7A6'];
  const COLOR_NAMES=['Ink','Pink','Blue','Yellow','Green','Orange','Brown','Peach'];
  const ERASE=8;          // color index used by the eraser (paints white)
  const SZ=[8,20,44];     // brush widths on the 0..1000 grid: thin, medium, thick

  const ALPH='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const AIDX={};for(let i=0;i<64;i++)AIDX[ALPH[i]]=i;
  function vput(out,v){do{let b=v%32;v=Math.floor(v/32);if(v>0)b+=32;out.push(ALPH[b]);}while(v>0);}
  const zz=d=>d>=0?2*d:-2*d-1, unzz=z=>z%2===0?z/2:-(z+1)/2;
  function encode(strokes){
    return strokes.filter(s=>s.p.length).map(s=>{
      const out=[ALPH[s.ci*3+s.si]];let px=s.p[0][0],py=s.p[0][1];vput(out,px);vput(out,py);
      for(let i=1;i<s.p.length;i++){const x=s.p[i][0],y=s.p[i][1];vput(out,zz(x-px));vput(out,zz(y-py));px=x;py=y;}
      return out.join('');
    }).join('.');
  }
  function decode(str){
    if(!str)return[];
    const res=[];
    str.split('.').forEach(seg=>{
      if(seg.length<3)return;
      const st=AIDX[seg[0]];if(st===undefined)return;
      let i=1;
      const read=()=>{let v=0,mul=1,b;do{if(i>=seg.length)return null;b=AIDX[seg[i++]];if(b===undefined)return null;v+=(b%32)*mul;mul*=32;}while(b>=32);return v;};
      let x=read(),y=read();if(x==null||y==null)return;
      const c=v=>Math.max(0,Math.min(1000,v));
      const p=[[c(x),c(y)]];
      while(i<seg.length){const dx=read(),dy=read();if(dx==null||dy==null)break;x+=unzz(dx);y+=unzz(dy);p.push([c(x),c(y)]);}
      res.push({ci:Math.min(ERASE,Math.floor(st/3)),si:st%3,p});
    });
    return res;
  }
  function rdp(pts,eps){
    if(pts.length<3)return pts;
    const keep=new Uint8Array(pts.length);keep[0]=keep[pts.length-1]=1;
    const stack=[[0,pts.length-1]];
    while(stack.length){
      const [a,b]=stack.pop();if(b-a<2)continue;
      const ax=pts[a][0],ay=pts[a][1],dx=pts[b][0]-ax,dy=pts[b][1]-ay,len=Math.hypot(dx,dy);
      let md=0,mi=-1;
      for(let i=a+1;i<b;i++){
        const d=len?Math.abs(dy*(pts[i][0]-ax)-dx*(pts[i][1]-ay))/len:Math.hypot(pts[i][0]-ax,pts[i][1]-ay);
        if(d>md){md=d;mi=i;}
      }
      if(md>eps){keep[mi]=1;stack.push([a,mi],[mi,b]);}
    }
    return pts.filter((p,i)=>keep[i]);
  }
  function paint(cv,strokes,prog){
    const ctx=cv.getContext('2d'),k=cv.width/1000;
    ctx.lineCap='round';ctx.lineJoin='round';
    ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,cv.width,cv.height);
    let budget=Infinity;
    if(prog<1){let tot=0;strokes.forEach(s=>tot+=s.p.length);budget=Math.floor(prog*tot);}
    for(const s of strokes){
      if(budget<=0)break;
      const col=s.ci===ERASE?'#FFFFFF':(COLORS[s.ci]||COLORS[0]);
      const w=SZ[s.si]*(s.ci===ERASE?1.8:1)*k;
      const n=Math.min(s.p.length,budget);budget-=s.p.length;
      if(s.p.length===1||n===1){ctx.fillStyle=col;ctx.beginPath();ctx.arc(s.p[0][0]*k,s.p[0][1]*k,w/2,0,Math.PI*2);ctx.fill();continue;}
      ctx.strokeStyle=col;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(s.p[0][0]*k,s.p[0][1]*k);
      for(let i=1;i<n;i++)ctx.lineTo(s.p[i][0]*k,s.p[i][1]*k);
      ctx.stroke();
    }
  }

  /** Split an encoded drawing into chunks of up to `per` pieces of `size` chars. */
  function chunk(enc,size,per){
    size=size||950;per=per||3;
    const pieces=[];for(let i=0;i<enc.length;i+=size)pieces.push(enc.slice(i,i+size));
    if(!pieces.length)pieces.push('');
    const out=[];for(let i=0;i<pieces.length;i+=per)out.push(pieces.slice(i,i+per));
    return out;
  }

  /** Encode strokes, simplifying harder until the result fits in `max` chars. */
  function encodeFitted(strokes,max){
    max=max||42000;let enc='';
    for(const eps of [1.2,2.5,5,9]){enc=encode(strokes.map(s=>({ci:s.ci,si:s.si,p:rdp(s.p,eps)})));if(enc.length<=max)break;}
    if(enc.length>max){const cut=enc.lastIndexOf('.',max);enc=cut>0?enc.slice(0,cut):'';}
    return enc;
  }

  const api={COLORS,COLOR_NAMES,ERASE,SZ,ALPH,encode,decode,rdp,paint,chunk,encodeFitted};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SketchyCodec = api;
})(this);
