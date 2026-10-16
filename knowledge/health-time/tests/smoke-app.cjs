const fs=require('fs'),vm=require('vm');
const elements={};
class E{constructor(id=''){this.id=id;this._html='';this.value=({mod:'150',vig:'0',strength:'2',bed:'23:00',rise:'07:00',sol:'15',waso:'10',tfa:'10',target:'8'}[id]||'');this.innerHTML='';this.textContent='';this.dataset={};this.handlers={};this.hidden=false;this.classList={toggle:(c,v)=>{this[c]=v}};this.options=[];}
 set innerHTML(v){this._html=v;if(v.includes('value=\"all\"'))this.value='all'} get innerHTML(){return this._html}
 addEventListener(k,f){this.handlers[k]=f} click(){this.handlers.click?.({target:this})} insertAdjacentHTML(_p,s){const m=s.match(/<option value="([^"]*)">/);if(m)this.options.push({value:m[1]})} querySelectorAll(){return []} reset(){}}
function el(id){return elements[id]||(elements[id]=new E(id))}
const tabs=['overview','exercise','rest','principles','sources'].map(v=>{const e=el('tab-'+v);e.dataset.view=v;return e});const views=['overview','exercise','rest','principles','sources'].map(v=>el(v));
const local=new Map();const context={window:{},document:{getElementById:el,querySelectorAll:s=>s==='.tab'?tabs:s==='.view'?views:[]},localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v)},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},Blob:function(){},console,Date,Math,JSON,Number,String,Array,Object,Map,Set,RegExp,Promise,Error};
context.document.createElement=()=>({click(){}});context.URL={createObjectURL:()=>'',revokeObjectURL(){}};context.Blob=function(){};context.window=context.window;context.window.HealthKnowledgeData={};
vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/../data/health-data.js','utf8'),context);vm.runInContext(fs.readFileSync(__dirname+'/../src/app.js','utf8'),context);
if(!el('exList').innerHTML.includes('中等強度等值分鐘'))throw Error('exercise cards not rendered');
if(!el('slList').innerHTML.includes('睡眠效率 SE-TIB'))throw Error('sleep cards not rendered');
el('calcExercise').click();if(!el('exerciseResult').innerHTML.includes('中等強度等值分鐘：150'))throw Error('exercise calculator failed');
el('calcSleep').click();if(!el('sleepResult').innerHTML.includes('7.42 小時'))throw Error('sleep calculator failed');
console.log('OK: page initialization and both calculators render');
