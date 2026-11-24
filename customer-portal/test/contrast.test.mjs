import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const luminance=hex=>hex.match(/[a-f\d]{2}/gi).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const ratio=(a,b)=>{const values=[luminance(a),luminance(b)].sort((x,y)=>y-x);return(values[0]+.05)/(values[1]+.05);};
test('reviewed small-text pairs and focus indicator exceed required contrast ratios',async()=>{
  const css=await readFile(new URL('../styles.css',import.meta.url),'utf8');
  for(const [label,fg,bg] of [['featured metric','#596b4f','#eaf1df'],['inactive filter','#596b4f','#f1f4ed'],['closed status','#596b4f','#f0f3eb'],['metadata','#596b4f','#ffffff'],['warning','#7e5818','#fcf1d9'],['primary action','#243c1a','#b0f447'],['sidebar','#b9c5b3','#142016']])assert.ok(ratio(fg,bg)>=4.5,`${label}: ${ratio(fg,bg)}`);
  assert.ok(ratio('#4a852d','#ffffff')>=3);assert.ok(ratio('#87947d','#ffffff')>=3);
  assert.match(css,/outline:3px solid #4a852d/);assert.match(css,/\.search-box input\{border-color:#87947d\}/);
});
